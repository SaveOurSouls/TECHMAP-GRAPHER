using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ComponentTemplateV2StoreTests
{
    [Fact]
    public void Explicit_v2_update_preserves_the_immutable_v1_version()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-template-v2", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var storage = SqliteStorage.Open(root);
            var store = new SqliteComponentTemplateStore(storage, TimeProvider.System);
            var v1 = store.Create("SERIES", "Series", [], 1, V1Content);

            var v2 = store.Update(v1.TemplateId, 1, "SERIES", "Series v2", [], 2, V2Content);

            Assert.Equal(2, v2.Version);
            Assert.Equal(2, v2.SchemaVersion);
            Assert.Equal(2, store.Get(v1.TemplateId).SchemaVersion);
            var historical = store.GetVersion(v1.TemplateId, 1);
            Assert.Equal(1, historical.SchemaVersion);
            Assert.Equal(v1.ContentJson, historical.ContentJson);
            Assert.Equal([2, 1], store.ListVersions(v1.TemplateId).Select(item => item.Version));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Invalid_v2_content_is_rejected_without_persisting_a_template()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-template-v2", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var storage = SqliteStorage.Open(root);
            var store = new SqliteComponentTemplateStore(storage, TimeProvider.System);
            var error = Assert.Throws<ComponentTemplateException>(() =>
                store.Create("INVALID", "Invalid", [], 2, V2Content.Replace(
                    "\"logicalContacts\":[]",
                    "\"logicalContacts\":[],\"unexpected\":true",
                    StringComparison.Ordinal)));

            Assert.Equal("component_template_content_invalid", error.Code);
            Assert.Equal("content", error.Field);
            Assert.Empty(store.List());
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    internal const string V1Content =
        """
        {"schemaVersion":1,"views":[{"id":"e4","name":"E4","kind":"e4","primitives":[],"contactPoints":[]},{"id":"drawing","name":"Drawing","kind":"drawing","primitives":[],"contactPoints":[]}]}
        """;

    internal const string V2Content =
        """
        {
          "schemaVersion":2,
          "views":[
            {"id":"00000000-0000-4000-8000-000000000001","name":"E4","kind":"e4","layers":[{"id":"00000000-0000-4000-8000-000000000002","name":"Main","visible":true,"locked":false,"nodes":[]}],"contactPoints":[],"bundlePorts":[],"repeatPlacements":[]},
            {"id":"00000000-0000-4000-8000-000000000003","name":"Drawing","kind":"drawing","layers":[{"id":"00000000-0000-4000-8000-000000000004","name":"Main","visible":true,"locked":false,"nodes":[]}],"contactPoints":[],"bundlePorts":[],"repeatPlacements":[]}
          ],
          "logicalContacts":[],
          "parameters":[],
          "repeaters":[],
          "assets":[],
          "articleParameterPresets":[]
        }
        """;
}
