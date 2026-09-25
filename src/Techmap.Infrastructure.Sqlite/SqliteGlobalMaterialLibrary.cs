using System.Text.Json;
using System.Text.RegularExpressions;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

/// <summary>Global preferences and bounded PNG payloads are included in ordinary SQLite backups.</summary>
public sealed class SqliteGlobalMaterialLibrary(SqliteStorage storage) : IGlobalMaterialLibrary
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public IReadOnlyList<GlobalMaterial> List() => storage.ExecuteRead(u =>
    {
        using var cmd = u.CreateCommand("SELECT metadata_json FROM global_materials ORDER BY material_id;");
        using var reader = cmd.ExecuteReader();
        var result = new List<GlobalMaterial>();
        while (reader.Read()) result.Add(JsonSerializer.Deserialize<GlobalMaterial>(reader.GetString(0), Json)!);
        return result;
    });

    public GlobalMaterial Get(Guid id) => storage.ExecuteRead(u =>
    {
        using var cmd = u.CreateCommand("SELECT metadata_json, image_png FROM global_materials WHERE material_id=$id;");
        cmd.Parameters.AddWithValue("$id", id.ToString("D"));
        using var reader = cmd.ExecuteReader();
        if (!reader.Read()) throw new KeyNotFoundException();
        return JsonSerializer.Deserialize<GlobalMaterial>(reader.GetString(0), Json)! with { ImageBase64 = Convert.ToBase64String((byte[])reader[1]) };
    });

    public GlobalMaterial Create(GlobalMaterial material) => Save(material, true);
    public GlobalMaterial Update(GlobalMaterial material) => Save(material, false);

    private GlobalMaterial Save(GlobalMaterial m, bool create)
    {
        var png = Validate(m);
        if (m.MaterialId == Guid.Empty) throw new ArgumentException("Не задан идентификатор материала.");
        if (create && m.Revision != 0 || !create && m.Revision < 1) throw new ArgumentException("Не задана версия материала.");
        return storage.ExecuteInTransaction(u =>
        {
            using var count = u.CreateCommand("SELECT COUNT(*) FROM global_materials;");
            if (create && Convert.ToInt64(count.ExecuteScalar()) >= 1000) throw new ArgumentException("Библиотека содержит 1000 материалов.");
            var saved = m with { Name = m.Name.Trim(), UpdatedUtc = DateTimeOffset.UtcNow, Revision = checked(m.Revision + 1) };
            using var cmd = u.CreateCommand(create
                ? "INSERT OR IGNORE INTO global_materials(material_id, revision, metadata_json, image_png) VALUES($id, $revision, $json, $png);"
                : "UPDATE global_materials SET revision=$revision, metadata_json=$json, image_png=$png WHERE material_id=$id AND revision=$expected;");
            cmd.Parameters.AddWithValue("$id", m.MaterialId.ToString("D"));
            cmd.Parameters.AddWithValue("$revision", saved.Revision);
            cmd.Parameters.AddWithValue("$json", JsonSerializer.Serialize(saved with { ImageBase64 = "" }, Json));
            cmd.Parameters.AddWithValue("$png", png);
            if (!create) cmd.Parameters.AddWithValue("$expected", m.Revision);
            if (cmd.ExecuteNonQuery() != 1) throw new MaterialConflictException();
            // One preferred material per covering kind; stale editors cannot resurrect a displaced default.
            if (saved.CoveringKind is { } kind)
            {
                using var other = u.CreateCommand("UPDATE global_materials SET revision=revision+1, metadata_json=json_set(metadata_json, '$.coveringKind', NULL, '$.revision', revision+1) WHERE material_id<>$id AND json_extract(metadata_json, '$.coveringKind')=$kind;");
                other.Parameters.AddWithValue("$id", saved.MaterialId.ToString("D")); other.Parameters.AddWithValue("$kind", kind);
                other.ExecuteNonQuery();
            }
            return saved;
        });
    }

    public void Delete(Guid id, long expectedRevision) => storage.ExecuteInTransaction(u =>
    {
        using var cmd = u.CreateCommand("DELETE FROM global_materials WHERE material_id=$id AND revision=$revision;");
        cmd.Parameters.AddWithValue("$id", id.ToString("D")); cmd.Parameters.AddWithValue("$revision", expectedRevision);
        if (cmd.ExecuteNonQuery() != 1) throw new MaterialConflictException();
    });

    private static byte[] Validate(GlobalMaterial m)
    {
        if (string.IsNullOrWhiteSpace(m.Name) || m.Name.Length > 255) throw new ArgumentException("Название материала обязательно (до 255 знаков).");
        if (m.MediaType != "image/png") throw new ArgumentException("Загрузите PNG; SVG преобразуется в PNG в редакторе.");
        if (m.CoveringKind is not (null or "heat-shrink" or "nylon" or "braid" or "metal-braid" or "tape" or "band")) throw new ArgumentException("Неизвестный тип оболочки.");
        foreach (var color in new[] { m.LineColor, m.Tint })
            if (color is null || !Regex.IsMatch(color, "^#[0-9a-fA-F]{6}$")) throw new ArgumentException("Цвет материала задан неверно.");
        foreach (var (n, min, max) in new[] { (m.LineWidth, .1, 20d), (m.TextureScale, .1, 10d), (m.TextureAngle, -180d, 180d) })
            if (!double.IsFinite(n) || n < min || n > max) throw new ArgumentException("Параметры текстуры вне диапазона.");
        if (m.ImageBase64 is null || m.ImageBase64.Length > 13981016) throw new ArgumentException("Изображение превышает 10 МиБ.");
        try
        {
            var bytes = Convert.FromBase64String(m.ImageBase64);
            if (bytes.Length is < 1 or > 10485760) throw new InvalidDataException();
            SqliteComponentTemplateStore.ValidateMaterialPng(bytes);
            return bytes;
        }
        catch (Exception e) when (e is FormatException or InvalidDataException or IOException or OverflowException or ArgumentException)
        { throw new ArgumentException("PNG повреждён или превышает допустимый размер.", e); }
    }
}
