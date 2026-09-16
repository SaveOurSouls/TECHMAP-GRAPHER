using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Techmap.Contracts;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ReferenceCatalogApiTests
{
    private const string Origin = "http://127.0.0.1:18762";

    [Fact]
    public async Task Validation_warning_acknowledgement_publication_and_active_reads_form_one_flow()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var snapshotId = Guid.NewGuid();
        var candidate = Candidate(snapshotId, "version-1", 17, includeWarning: true);

        using var missing = await client.GetAsync(
            "/api/v1/reference-sources/technology-database/active",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal(
            "catalog_active_snapshot_not_found",
            (await missing.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken))?.Error);

        using var validationResponse = await SendAsync(
            client,
            "/api/v1/reference-sources/technology-database/validations",
            candidate,
            csrf);
        Assert.Equal(HttpStatusCode.OK, validationResponse.StatusCode);
        var validation = Assert.IsType<ReferenceCatalogSnapshotResponse>(
            await validationResponse.Content.ReadFromJsonAsync<ReferenceCatalogSnapshotResponse>(
                TestContext.Current.CancellationToken));
        var warning = Assert.Single(validation.Diagnostics);

        var publication = new PublishReferenceCatalogRequest(
            candidate.SnapshotId,
            candidate.ContractVersion,
            candidate.CapturedUtc,
            candidate.SourceKind,
            candidate.VersionFingerprint,
            candidate.SourceUri,
            candidate.Records,
            candidate.Diagnostics,
            ExpectedActiveSnapshotId: null,
            validation.Sha256,
            AcknowledgedWarningIds: []);
        using var unacknowledged = await SendAsync(
            client,
            "/api/v1/reference-sources/technology-database/publications",
            publication,
            csrf);
        Assert.Equal(HttpStatusCode.Conflict, unacknowledged.StatusCode);
        Assert.Equal(
            "catalog_warnings_require_acknowledgement",
            (await unacknowledged.Content.ReadFromJsonAsync<ApiErrorResponse>(
                TestContext.Current.CancellationToken))?.Error);

        using var publishedResponse = await SendAsync(
            client,
            "/api/v1/reference-sources/technology-database/publications",
            publication with { AcknowledgedWarningIds = [warning.DiagnosticId] },
            csrf);
        Assert.Equal(HttpStatusCode.Created, publishedResponse.StatusCode);
        var published = Assert.IsType<ReferenceCatalogPublicationResponse>(
            await publishedResponse.Content.ReadFromJsonAsync<ReferenceCatalogPublicationResponse>(
                TestContext.Current.CancellationToken));
        Assert.Equal("published", published.Status);
        Assert.Equal(snapshotId, published.Snapshot.SnapshotId);

        using var activeResponse = await client.GetAsync(
            "/api/v1/reference-sources/technology-database/active",
            TestContext.Current.CancellationToken);
        using var recordsResponse = await client.GetAsync(
            "/api/v1/reference-sources/technology-database/active/records",
            TestContext.Current.CancellationToken);
        var active = await activeResponse.Content.ReadFromJsonAsync<ReferenceCatalogSnapshotResponse>(
            TestContext.Current.CancellationToken);
        var records = await recordsResponse.Content.ReadFromJsonAsync<ReferenceCatalogRecordListResponse>(
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, activeResponse.StatusCode);
        Assert.Equal(HttpStatusCode.OK, recordsResponse.StatusCode);
        Assert.Equal(validation.Sha256, active?.Sha256);
        Assert.Equal(snapshotId, records?.SnapshotId);
        Assert.Equal(17, Assert.Single(records!.Records).Payload.GetProperty("value").GetInt32());

        using var sourcesResponse = await client.GetAsync(
            "/api/v1/reference-sources",
            TestContext.Current.CancellationToken);
        var sources = await sourcesResponse.Content.ReadFromJsonAsync<ReferenceCatalogSourceSummaryResponse[]>(
            TestContext.Current.CancellationToken);
        var source = Assert.Single(sources!);
        Assert.Equal(HttpStatusCode.OK, sourcesResponse.StatusCode);
        Assert.Equal("technology-database", source.SourceId);
        Assert.Equal("xlsx", source.SourceKind);
        Assert.Equal(snapshotId, source.ActiveSnapshotId);
        Assert.Equal(1, source.RecordCount);
    }

    [Fact]
    public async Task Publication_rejects_stale_validation_and_mutation_without_local_security_context()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var candidate = Candidate(Guid.NewGuid(), "version-1", 1, includeWarning: false);
        var invalidHashPublication = Publish(candidate, new string('0', 64));

        using var changed = await SendAsync(
            client,
            "/api/v1/reference-sources/technology-database/publications",
            invalidHashPublication,
            csrf);
        Assert.Equal(HttpStatusCode.Conflict, changed.StatusCode);
        Assert.Equal(
            "catalog_validation_changed",
            (await changed.Content.ReadFromJsonAsync<ApiErrorResponse>(
                TestContext.Current.CancellationToken))?.Error);

        using var unauthenticatedClient = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("http://127.0.0.1:18762"),
        });
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "/api/v1/reference-sources/technology-database/validations")
        {
            Content = JsonContent.Create(candidate),
        };
        request.Headers.TryAddWithoutValidation("Origin", Origin);
        request.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, csrf);
        using var rejected = await unauthenticatedClient.SendAsync(
            request,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
    }

    private static ValidateReferenceCatalogRequest Candidate(
        Guid snapshotId,
        string version,
        int value,
        bool includeWarning)
    {
        using var payload = JsonDocument.Parse($"{{\"value\":{value}}}");
        return new ValidateReferenceCatalogRequest(
            snapshotId,
            1,
            new DateTimeOffset(2026, 9, 12, 18, 0, 0, TimeSpan.Zero),
            "xlsx",
            version,
            "technology-database.xlsx",
            [new ReferenceCatalogRecordInputRequest(
                "terminal", "TER-001", payload.RootElement.Clone(), "БД.ТЕР!2")],
            includeWarning
                ? [new ReferenceCatalogDiagnosticInputRequest(
                    "warning", "review-required", "Review imported value.",
                    "terminal", "TER-001", "value", "БД.ТЕР!2")]
                : []);
    }

    private static PublishReferenceCatalogRequest Publish(
        ValidateReferenceCatalogRequest candidate,
        string validationHash) => new(
        candidate.SnapshotId,
        candidate.ContractVersion,
        candidate.CapturedUtc,
        candidate.SourceKind,
        candidate.VersionFingerprint,
        candidate.SourceUri,
        candidate.Records,
        candidate.Diagnostics,
        ExpectedActiveSnapshotId: null,
        validationHash,
        AcknowledgedWarningIds: []);

    private static async Task<string> StartSessionAsync(HttpClient client)
    {
        using var page = await client.GetAsync("/", TestContext.Current.CancellationToken);
        page.EnsureSuccessStatusCode();
        var session = await client.GetFromJsonAsync<SessionBootstrapResponse>(
            "/api/v1/session",
            TestContext.Current.CancellationToken);
        return Assert.IsType<SessionBootstrapResponse>(session).CsrfNonce;
    }

    private static async Task<HttpResponseMessage> SendAsync(
        HttpClient client,
        string path,
        object body,
        string csrf)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = JsonContent.Create(body),
        };
        request.Headers.TryAddWithoutValidation("Origin", Origin);
        request.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, csrf);
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }
}
