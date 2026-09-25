namespace Techmap.Application;

public sealed record GlobalMaterial(
    Guid MaterialId, string Name, string MediaType, string ImageBase64,
    string LineColor, double LineWidth, double TextureAngle, double TextureScale,
    string Tint, string? CoveringKind, DateTimeOffset UpdatedUtc, long Revision = 0);

public interface IGlobalMaterialLibrary
{
    IReadOnlyList<GlobalMaterial> List();
    GlobalMaterial Get(Guid id);
    GlobalMaterial Create(GlobalMaterial material);
    GlobalMaterial Update(GlobalMaterial material);
    void Delete(Guid materialId, long expectedRevision);
}

public sealed class MaterialConflictException() : Exception("Материал изменён в другом окне. Обновите библиотеку.");
