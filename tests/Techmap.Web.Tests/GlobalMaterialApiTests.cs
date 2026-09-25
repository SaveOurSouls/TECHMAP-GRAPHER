using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Techmap.Application;
using Techmap.Contracts;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class GlobalMaterialApiTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Crud_detects_stale_edits_and_type_reassignment_and_preserves_png()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await Start(client);
        var list = await client.GetFromJsonAsync<JsonElement>("/api/v1/material-library", Ct);
        Assert.Equal(54, list.GetProperty("materials").GetArrayLength());
        Assert.Equal(48, list.GetProperty("materials").EnumerateArray().Count(m => m.GetProperty("hatchCode").ValueKind == JsonValueKind.String));
        var seedId = list.GetProperty("materials")[0].GetProperty("materialId").GetGuid();
        var seed = (await client.GetFromJsonAsync<GlobalMaterial>($"/api/v1/material-library/{seedId}", Ct))!;
        var body = seed with { MaterialId = Guid.NewGuid(), Name = "API материал", CoveringKind = "heat-shrink", Revision = 0 };
        using var created = await Send(client, HttpMethod.Post, "/api/v1/material-library", body, csrf);
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var saved = (await created.Content.ReadFromJsonAsync<GlobalMaterial>(Ct))!;
        Assert.Equal(1, saved.Revision);
        var route = $"/api/v1/material-library/{saved.MaterialId}";
        using var updated = await Send(client, HttpMethod.Put, route, saved with { Name = "Updated", Tint = "#000000", BackgroundColor = "#abcdef", HatchCode = "H07", HatchLineWidth = 2.5 }, csrf);
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        var version2 = (await updated.Content.ReadFromJsonAsync<GlobalMaterial>(Ct))!;
        Assert.Equal(2, version2.Revision);
        Assert.Equal("#abcdef", version2.BackgroundColor);
        Assert.Equal("H07", version2.HatchCode);
        Assert.Equal(2.5, version2.HatchLineWidth);
        using var stale = await Send(client, HttpMethod.Put, route, saved, csrf);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        using var staleDelete = await Send(client, HttpMethod.Delete, route + "?expectedRevision=1", null, csrf);
        Assert.Equal(HttpStatusCode.Conflict, staleDelete.StatusCode);
        var bytes = await client.GetByteArrayAsync(route + "/image", Ct);
        Assert.Equal(Convert.FromBase64String(seed.ImageBase64), bytes);
        var refreshed = await client.GetFromJsonAsync<JsonElement>("/api/v1/material-library", Ct);
        Assert.Single(refreshed.GetProperty("materials").EnumerateArray(), m => m.GetProperty("coveringKind").GetString() == "heat-shrink");
        using var deleted = await Send(client, HttpMethod.Delete, route + "?expectedRevision=2", null, csrf);
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        using var missing = await client.GetAsync(route, Ct);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Theory]
    [InlineData("image/png", "broken", "band", 1)]
    [InlineData("image/svg+xml", "PHN2Zz48c2NyaXB0Lz48L3N2Zz4=", "band", 1)]
    [InlineData("image/png", "", "invalid", 1)]
    [InlineData("image/png", "", "band", 0)]
    public async Task Malformed_upload_or_settings_do_not_change_library(string mediaType, string image, string kind, double width)
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient(); var csrf = await Start(client);
        var before = await client.GetStringAsync("/api/v1/material-library", Ct);
        var bad = new GlobalMaterial(Guid.NewGuid(), "Bad", mediaType, image, "#000000", width, 0, 1, "#ffffff", kind, DateTimeOffset.UtcNow);
        using var response = await Send(client, HttpMethod.Post, "/api/v1/material-library", bad, csrf);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(before, await client.GetStringAsync("/api/v1/material-library", Ct));
    }

    [Fact]
    public async Task Read_requires_session_and_mutation_requires_csrf()
    {
        await using var factory = new TechmapWebApplicationFactory(); using var client = factory.CreateLocalClient();
        using var read = await client.GetAsync("/api/v1/material-library", Ct);
        Assert.Equal(HttpStatusCode.Unauthorized, read.StatusCode);
        await Start(client);
        using var mutation = await Send(client, HttpMethod.Delete, $"/api/v1/material-library/{Guid.NewGuid()}?expectedRevision=1", null, "bad");
        Assert.Equal(HttpStatusCode.Forbidden, mutation.StatusCode);
    }

    private static async Task<string> Start(HttpClient client)
    {
        using var page = await client.GetAsync("/", Ct); page.EnsureSuccessStatusCode();
        return (await client.GetFromJsonAsync<SessionBootstrapResponse>("/api/v1/session", Ct))!.CsrfNonce;
    }
    private static async Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path, object? body, string csrf)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.TryAddWithoutValidation("Origin", "http://127.0.0.1:18762");
        request.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, csrf);
        request.Content = JsonContent.Create(body ?? new { });
        return await client.SendAsync(request, Ct);
    }
}
