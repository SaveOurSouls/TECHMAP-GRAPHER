using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ComponentTemplateV2StoreTests
{
    [Fact]
    public void Store_accepts_v3_and_keeps_an_immutable_v2_version_readable()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-template-v3", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var storage = SqliteStorage.Open(root);
            var store = new SqliteComponentTemplateStore(storage, TimeProvider.System);
            var v2 = store.Create("SERIES-V3", "Series", [], 2, V2Content);

            var v3 = store.Update(
                v2.TemplateId, v2.Version, "SERIES-V3", "Series v3",
                ComponentTemplateContentV3ValidatorTests.ValidArticleBindings, 3,
                ComponentTemplateContentV3ValidatorTests.ValidContentJson);

            Assert.Equal(3, v3.SchemaVersion);
            Assert.Equal(2, store.GetVersion(v2.TemplateId, 1).SchemaVersion);
            Assert.Equal(v2.ContentJson, store.GetVersion(v2.TemplateId, 1).ContentJson);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Store_accepts_500_article_bindings_and_rejects_501()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-template-binding-limit", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var storage = SqliteStorage.Open(root);
            var store = new SqliteComponentTemplateStore(storage, TimeProvider.System);
            var bindings = Enumerable.Range(0, 500)
                .Select(index => new ComponentTemplateArticleBinding("db", "connector", $"A-{index:D3}"))
                .ToArray();

            var accepted = store.Create("LIMIT-500", "Limit", bindings, 1, V1Content);
            Assert.Equal(500, accepted.ArticleBindings.Count);

            var error = Assert.Throws<ComponentTemplateException>(() => store.Create(
                "LIMIT-501", "Limit", [.. bindings, new("db", "connector", "A-500")], 1, V1Content));
            Assert.Equal("component_template_bindings_invalid", error.Code);
            Assert.Equal("articleBindings", error.Field);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task V3_asset_commands_keep_metadata_atomic_and_protect_referenced_images()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-template-v3-assets", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var storage = SqliteStorage.Open(root);
            var store = new SqliteComponentTemplateStore(storage, TimeProvider.System);
            var created = store.Create(
                "ASSET-V3", "Asset v3", ComponentTemplateContentV3ValidatorTests.ValidArticleBindings, 3,
                ComponentTemplateContentV3ValidatorTests.ValidContentJson);
            var added = await store.AddAssetAsync(
                created.TemplateId, 1, new MemoryStream(Png), "symbol.png", "image/png",
                TestContext.Current.CancellationToken);
            var asset = Assert.Single(added.Assets);
            AssertContentAsset(added.ContentJson, asset);

            var referenced = JsonNode.Parse(added.ContentJson)!.AsObject();
            referenced["views"]![0]!["layers"]![0]!["nodes"]!.AsArray().Add(ImageNode(asset.AssetId));
            var saved = store.Update(created.TemplateId, 2, "ASSET-V3", "Asset v3",
                ComponentTemplateContentV3ValidatorTests.ValidArticleBindings, 3, referenced.ToJsonString());
            var error = Assert.Throws<ComponentTemplateException>(() =>
                store.RemoveAsset(created.TemplateId, saved.Version, asset.AssetId));
            Assert.Equal("component_template_asset_in_use", error.Code);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task V2_asset_commands_keep_content_metadata_and_history_in_lockstep()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-template-v2", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var storage = SqliteStorage.Open(root);
            var store = new SqliteComponentTemplateStore(storage, TimeProvider.System);
            var created = store.Create("ASSETS", "Assets", [], 2, V2Content);
            var added = await store.AddAssetAsync(
                created.TemplateId,
                1,
                new MemoryStream(Png),
                "symbol.png",
                "image/png",
                TestContext.Current.CancellationToken);

            var asset = Assert.Single(added.Assets);
            AssertContentAsset(added.ContentJson, asset);
            Assert.Empty(ContentAssets(store.GetVersion(created.TemplateId, 1)));

            var removed = store.RemoveAsset(created.TemplateId, 2, asset.AssetId);

            Assert.Empty(removed.Assets);
            Assert.Empty(ContentAssets(removed));
            AssertContentAsset(store.GetVersion(created.TemplateId, 2).ContentJson, asset);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task Explicit_v1_to_v2_upgrade_matches_assets_by_id_instead_of_ordinal()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-template-v2", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var storage = SqliteStorage.Open(root);
            var store = new SqliteComponentTemplateStore(storage, TimeProvider.System);
            var created = store.Create("ORDER", "Order", [], 1, V1Content);
            var one = await store.AddAssetAsync(
                created.TemplateId, 1, new MemoryStream(Png), "first.png", "image/png",
                TestContext.Current.CancellationToken);
            var two = await store.AddAssetAsync(
                created.TemplateId, 2, new MemoryStream(Png), "second.png", "image/png",
                TestContext.Current.CancellationToken);
            var reverseIds = new[]
            {
                Guid.Parse("ffffffff-ffff-4fff-bfff-ffffffffffff"),
                Guid.Parse("11111111-1111-4111-8111-111111111111"),
            };
            var reverseOrdinalAssets = two.Assets.Select((asset, index) => asset with
            {
                AssetId = reverseIds[index],
            }).ToArray();
            var versionHash = SqliteComponentTemplateStore.ComputeVersionHash(
                two.TemplateId, two.Version, two.SchemaVersion, two.Code, two.Name,
                two.ArticleBindings, reverseOrdinalAssets, two.ContentJson);
            storage.ExecuteInTransaction(unitOfWork =>
            {
                using var command = unitOfWork.CreateCommand(
                    """
                    DROP TRIGGER prevent_component_template_asset_update;
                    DROP TRIGGER prevent_component_template_version_update;
                    UPDATE component_template_asset_refs
                    SET asset_id = CASE asset_ordinal WHEN 0 THEN $firstId ELSE $secondId END
                    WHERE template_id = $templateId AND version = 3;
                    UPDATE component_template_versions
                    SET version_sha256 = $versionHash
                    WHERE template_id = $templateId AND version = 3;
                    """);
                command.Parameters.AddWithValue("$templateId", two.TemplateId.ToString("D"));
                command.Parameters.AddWithValue("$firstId", reverseIds[0].ToString("D"));
                command.Parameters.AddWithValue("$secondId", reverseIds[1].ToString("D"));
                command.Parameters.AddWithValue("$versionHash", versionHash);
                command.ExecuteNonQuery();
            });

            var v2Content = JsonNode.Parse(V2Content)!.AsObject();
            var contentAssets = v2Content["assets"]!.AsArray();
            foreach (var asset in reverseOrdinalAssets.OrderBy(item => item.AssetId.ToString("D"), StringComparer.Ordinal))
            {
                contentAssets.Add(AssetMetadata(
                    asset.AssetId, asset.FileName, asset.Content.Sha256, asset.Content.SizeBytes));
            }

            var upgraded = store.Update(
                created.TemplateId, 3, "ORDER", "Order v2", [], 2, v2Content.ToJsonString());

            Assert.Equal(2, upgraded.SchemaVersion);
            Assert.Equal(reverseIds, upgraded.Assets.Select(item => item.AssetId));
            Assert.Equal(
                reverseIds.OrderBy(item => item.ToString("D"), StringComparer.Ordinal),
                ContentAssets(upgraded).Select(item => Guid.Parse(item!["assetId"]!.GetValue<string>())));
            Assert.Equal(1, store.GetVersion(created.TemplateId, 3).SchemaVersion);
            Assert.Equal(one.Assets[0].Content, upgraded.Assets[0].Content);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task V2_save_requires_exact_asset_metadata_and_referenced_assets_cannot_be_removed()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-template-v2", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var storage = SqliteStorage.Open(root);
            var store = new SqliteComponentTemplateStore(storage, TimeProvider.System);
            var created = store.Create("USED", "Used", [], 2, V2Content);
            var withAsset = await store.AddAssetAsync(
                created.TemplateId, 1, new MemoryStream(Png), "symbol.png", "image/png",
                TestContext.Current.CancellationToken);
            var asset = Assert.Single(withAsset.Assets);

            var mismatched = JsonNode.Parse(withAsset.ContentJson)!.AsObject();
            mismatched["assets"]![0]!["fileName"] = "other.png";
            var mismatch = Assert.Throws<ComponentTemplateException>(() => store.Update(
                created.TemplateId, 2, "USED", "Used", [], 2, mismatched.ToJsonString()));
            Assert.Equal("component_template_asset_metadata_mismatch", mismatch.Code);
            Assert.Equal("content.assets[0]", mismatch.Field);
            Assert.Equal(2, store.Get(created.TemplateId).Version);

            var referenced = JsonNode.Parse(withAsset.ContentJson)!.AsObject();
            referenced["views"]![0]!["layers"]![0]!["nodes"]!.AsArray().Add(ImageNode(asset.AssetId));
            var saved = store.Update(created.TemplateId, 2, "USED", "Used", [], 2, referenced.ToJsonString());
            var inUse = Assert.Throws<ComponentTemplateException>(() =>
                store.RemoveAsset(created.TemplateId, 3, asset.AssetId));
            Assert.Equal("component_template_asset_in_use", inUse.Code);
            Assert.Equal("content.views[0].layers[0].nodes[0].geometry.assetId", inUse.Field);
            Assert.Equal(saved.ContentJson, store.Get(created.TemplateId).ContentJson);
            Assert.Single(store.GetVersion(created.TemplateId, 2).Assets);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void V2_create_rejects_declared_assets_without_top_level_refs()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-template-v2", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var storage = SqliteStorage.Open(root);
            var store = new SqliteComponentTemplateStore(storage, TimeProvider.System);
            var content = JsonNode.Parse(V2Content)!.AsObject();
            content["assets"]!.AsArray().Add(AssetMetadata(Guid.NewGuid(), "a.png", new string('a', 64), 1));

            var error = Assert.Throws<ComponentTemplateException>(() =>
                store.Create("DECLARED", "Declared", [], 2, content.ToJsonString()));

            Assert.Equal("component_template_asset_metadata_mismatch", error.Code);
            Assert.Equal("content.assets", error.Field);
            Assert.Empty(store.List());
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

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

    private static JsonArray ContentAssets(ComponentTemplateVersion template) =>
        JsonNode.Parse(template.ContentJson)!["assets"]!.AsArray();

    private static void AssertContentAsset(string contentJson, ComponentTemplateAsset expected)
    {
        var actual = Assert.Single(JsonNode.Parse(contentJson)!["assets"]!.AsArray());
        Assert.Equal(expected.AssetId.ToString("D"), actual!["assetId"]!.GetValue<string>());
        Assert.Equal(expected.FileName, actual["fileName"]!.GetValue<string>());
        Assert.Equal(expected.MediaType, actual["mediaType"]!.GetValue<string>());
        Assert.Equal(expected.Content.Sha256, actual["sha256"]!.GetValue<string>());
        Assert.Equal(expected.Content.SizeBytes, actual["sizeBytes"]!.GetValue<long>());
    }

    private static JsonObject AssetMetadata(Guid id, string fileName, string sha256, long sizeBytes) => new()
    {
        ["assetId"] = id.ToString("D"), ["fileName"] = fileName, ["mediaType"] = "image/png",
        ["sha256"] = sha256, ["sizeBytes"] = sizeBytes,
    };

    internal static JsonObject ImageNode(Guid assetId) => new()
    {
        ["id"] = "00000000-0000-4000-8000-000000000005",
        ["kind"] = "image",
        ["layerId"] = "00000000-0000-4000-8000-000000000002",
        ["visible"] = true,
        ["locked"] = false,
        ["opacity"] = 1,
        ["transform"] = new JsonObject
        {
            ["translateX"] = Constant(0), ["translateY"] = Constant(0),
            ["rotationDegrees"] = Constant(0), ["scaleX"] = Constant(1), ["scaleY"] = Constant(1),
        },
        ["stroke"] = new JsonObject { ["color"] = "#112233", ["width"] = Constant(1) },
        ["fill"] = new JsonObject { ["color"] = null },
        ["geometry"] = new JsonObject
        {
            ["assetId"] = assetId.ToString("D"), ["x"] = Constant(0), ["y"] = Constant(0),
            ["width"] = Constant(10), ["height"] = Constant(10),
            ["cropX"] = 0, ["cropY"] = 0, ["cropWidth"] = 1, ["cropHeight"] = 1, ["underlay"] = false,
        },
    };

    private static JsonObject Constant(double value) => new() { ["kind"] = "constant", ["value"] = value };

    internal static readonly byte[] Png = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
}
