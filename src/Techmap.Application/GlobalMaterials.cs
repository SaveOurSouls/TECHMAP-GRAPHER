namespace Techmap.Application;

public sealed record GlobalMaterial(
    Guid MaterialId, string Name, string MediaType, string ImageBase64,
    string LineColor, double LineWidth, double TextureAngle, double TextureScale,
    string Tint, string? CoveringKind, DateTimeOffset UpdatedUtc, long Revision = 0,
    string BackgroundColor = GlobalMaterialDefaults.BackgroundColor,
    string? HatchCode = null, double HatchLineWidth = 1);

// Background is intentionally an additive field so existing libraries keep their
// saved texture colour and receive the neutral background on first read.
public static class GlobalMaterialDefaults
{
    public const string BackgroundColor = "#f3f5f6";
}

public interface IGlobalMaterialLibrary
{
    IReadOnlyList<GlobalMaterial> List();
    GlobalMaterial Get(Guid id);
    GlobalMaterial Create(GlobalMaterial material);
    GlobalMaterial Update(GlobalMaterial material);
    void Delete(Guid materialId, long expectedRevision);
}

public sealed class MaterialConflictException() : Exception("Материал изменён в другом окне. Обновите библиотеку.");
