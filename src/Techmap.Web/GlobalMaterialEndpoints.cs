using System.Text.Json;
using Techmap.Application;
using Techmap.Contracts;

namespace Techmap.Web;

public static class GlobalMaterialEndpoints
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static void MapGlobalMaterialEndpoints(this WebApplication app)
    {
        const string route = "/api/v1/material-library";
        app.MapGet(route, (HttpContext c, LocalHttpSession s, IGlobalMaterialLibrary store) =>
            s.HasValidCookie(c.Request) ? Results.Ok(new { materials = store.List() }) : Results.Unauthorized());
        app.MapGet(route + "/{id:guid}", (Guid id, HttpContext c, LocalHttpSession s, IGlobalMaterialLibrary store) =>
            s.HasValidCookie(c.Request) ? Execute(() => Results.Ok(store.Get(id))) : Results.Unauthorized());
        app.MapGet(route + "/{id:guid}/image", (Guid id, HttpContext c, LocalHttpSession s, IGlobalMaterialLibrary store) =>
            s.HasValidCookie(c.Request) ? Execute(() => Results.Bytes(Convert.FromBase64String(store.Get(id).ImageBase64), "image/png")) : Results.Unauthorized());
        app.MapPost(route, (HttpContext c, IGlobalMaterialLibrary store, CancellationToken ct) => Mutate(c, store, null, ct));
        app.MapPut(route + "/{id:guid}", (HttpContext c, Guid id, IGlobalMaterialLibrary store, CancellationToken ct) => Mutate(c, store, id, ct));
        app.MapDelete(route + "/{id:guid}", (Guid id, long expectedRevision, IGlobalMaterialLibrary store) => Execute(() =>
        { store.Delete(id, expectedRevision); return Results.NoContent(); }));
    }

    private static async Task<IResult> Mutate(HttpContext c, IGlobalMaterialLibrary store, Guid? id, CancellationToken ct)
    {
        const int limit = 14 * 1024 * 1024;
        if (c.Request.ContentLength > limit) return Results.StatusCode(413);
        using var buffer = new MemoryStream(); var chunk = new byte[65536];
        int read;
        while ((read = await c.Request.Body.ReadAsync(chunk, ct)) != 0)
        { if (buffer.Length + read > limit) return Results.StatusCode(413); buffer.Write(chunk, 0, read); }
        return Execute(() =>
        {
            var value = JsonSerializer.Deserialize<GlobalMaterial>(buffer.ToArray(), Json) ?? throw new ArgumentException("Материал не задан.");
            if (id is not null && id != value.MaterialId) throw new ArgumentException("Идентификатор материала не совпадает.");
            return Results.Ok(id is null ? store.Create(value) : store.Update(value));
        });
    }

    private static IResult Execute(Func<IResult> action)
    {
        try { return action(); }
        catch (MaterialConflictException e) { return Results.Conflict(new ApiErrorResponse("material_conflict", Message: e.Message)); }
        catch (KeyNotFoundException) { return Results.NotFound(); }
        catch (Exception e) when (e is ArgumentException or JsonException or OverflowException)
        { return Results.BadRequest(new ApiErrorResponse("material_invalid", Message: e.Message)); }
    }
}
