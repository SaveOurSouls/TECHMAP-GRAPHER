using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ProjectComponentPlacementPortabilityTests
{
    [Theory]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    public async Task Backup_accepts_placed_component_schemas_used_by_startup_validation(int schemaVersion)
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.SourceDataRoot);
        _ = CreateSourceGraph(storage, schemaVersion);
        using var backups = new SqliteStorageBackupService(fixture.SourceDataRoot, storage.Layout.DatabasePath);
        var result = await backups.CreateAsync(
            new StorageBackupRequest(Path.Combine(fixture.Root, "backups"), "0.19.0-m4-05"),
            TestContext.Current.CancellationToken);
        Assert.NotNull(result);
    }

    [Theory]
    [InlineData(4)]
    [InlineData(5)]
    public async Task Export_import_remaps_component_ids_but_preserves_wire_cable_and_template_identity(int schemaVersion)
    {
        using var fixture = Fixture.Create();
        SourceGraph source;
        await using (var sourceLease = DataRootLease.Acquire(fixture.SourceDataRoot))
        {
            using var sourceStorage = SqliteStorage.Open(sourceLease.CanonicalPath);
            source = CreateSourceGraph(sourceStorage, schemaVersion);
            await new SqliteProjectExportService(sourceLease, sourceStorage).ExportAsync(
                new ProjectExportRequest(source.ProjectId, fixture.ArchivePath, "0.4.0-m3.01"),
                TestContext.Current.CancellationToken);
        }

        await using var destinationLease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var destinationStorage = SqliteStorage.Open(destinationLease.CanonicalPath);
        var imported = await new SqliteProjectImportService(destinationLease, destinationStorage).ImportAsync(
            new ProjectImportRequest(fixture.ArchivePath, "0.4.0-m3.01"),
            TestContext.Current.CancellationToken);
        var importedProject = new SqliteProjectCatalog(destinationStorage).GetProject(imported.ProjectId);
        var importedHarness = Assert.Single(importedProject.Harnesses);

        AssertPortableGraph(destinationStorage, importedProject.ProjectId, importedHarness.HarnessId, source);
    }

    [Fact]
    public void Copy_remaps_component_ids_but_preserves_wire_cable_and_template_identity()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.SourceDataRoot);
        var source = CreateSourceGraph(storage);

        var copy = new SqliteProjectCatalog(storage).CopyProject(source.ProjectId);
        var copiedHarness = Assert.Single(copy.Harnesses);

        AssertPortableGraph(storage, copy.ProjectId, copiedHarness.HarnessId, source);
        var sourcePlacements = new SqliteProjectComponentSnapshotStore(storage, TimeProvider.System)
            .ListPlacements(source.ProjectId, source.HarnessId);
        Assert.Equal(source.PlacementIds.Order(), sourcePlacements.Select(item => item.PlacementId).Order());
    }

    [Fact]
    public void Copy_ignores_commanded_placement_removed_from_live_design_and_its_snapshot()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.SourceDataRoot);
        var source = CreateSourceGraph(storage);
        var designStore = new SqliteHarnessDesignDocumentStore(storage, TimeProvider.System);
        var current = designStore.Get(source.ProjectId, source.HarnessId);
        var content = JsonNode.Parse(current.ContentJson)!.AsObject();
        content["connectors"] = new JsonArray();
        content["wires"] = new JsonArray();
        content["cables"] = new JsonArray();

        _ = designStore.Put(
            source.ProjectId,
            source.HarnessId,
            current.Revision,
            SqliteHarnessDesignDocumentStore.CurrentContentSchemaVersion,
            content.ToJsonString());

        var sourceStore = new SqliteProjectComponentSnapshotStore(storage, TimeProvider.System);
        Assert.Empty(sourceStore.ListPlacements(source.ProjectId, source.HarnessId));
        Assert.Single(sourceStore.ListSnapshots(source.ProjectId));
        var auditRows = storage.ExecuteRead(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                "SELECT COUNT(*) FROM harness_component_placements WHERE harness_id = $harnessId;");
            command.Parameters.AddWithValue("$harnessId", source.HarnessId.Value.ToString("D"));
            return Convert.ToInt32(command.ExecuteScalar());
        });
        Assert.Equal(2, auditRows);

        var copy = new SqliteProjectCatalog(storage).CopyProject(source.ProjectId);
        var copiedHarness = Assert.Single(copy.Harnesses);
        var copiedStore = new SqliteProjectComponentSnapshotStore(storage, TimeProvider.System);
        Assert.Empty(copiedStore.ListPlacements(copy.ProjectId, copiedHarness.HarnessId));
        Assert.Empty(copiedStore.ListSnapshots(copy.ProjectId));
        using var copiedDesign = JsonDocument.Parse(
            designStore.Get(copy.ProjectId, copiedHarness.HarnessId).ContentJson);
        Assert.Empty(copiedDesign.RootElement.GetProperty("connectors").EnumerateArray());
        Assert.Empty(copiedDesign.RootElement.GetProperty("wires").EnumerateArray());
        Assert.Empty(copiedDesign.RootElement.GetProperty("cables").EnumerateArray());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Retained_snapshot_without_placements_survives_startup_backup_and_restore(bool deleteHarness)
    {
        using var fixture = Fixture.Create();
        ProjectIdentity projectId;
        ProjectComponentSnapshot snapshot;
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.SourceDataRoot))
        {
            var source = CreateSourceGraph(storage);
            var catalog = new SqliteProjectCatalog(storage);
            // Copies have no placement-command journal; removing their last component
            // removes the placement rows while keeping the immutable project snapshot.
            var project = deleteHarness ? catalog.GetProject(source.ProjectId) : catalog.CopyProject(source.ProjectId);
            projectId = project.ProjectId;
            var harness = Assert.Single(project.Harnesses);
            snapshot = Assert.Single(new SqliteProjectComponentSnapshotStore(storage, TimeProvider.System).ListSnapshots(projectId));
            if (deleteHarness)
                catalog.DeleteHarness(projectId, harness.HarnessId);
            else
            {
                var designs = new SqliteHarnessDesignDocumentStore(storage, TimeProvider.System);
                var design = designs.Get(projectId, harness.HarnessId);
                var content = JsonNode.Parse(design.ContentJson)!.AsObject();
                content["connectors"] = new JsonArray();
                content["wires"] = new JsonArray();
                content["cables"] = new JsonArray();
                designs.Put(projectId, harness.HarnessId, design.Revision,
                    SqliteHarnessDesignDocumentStore.CurrentContentSchemaVersion, content.ToJsonString());
            }
            var placements = storage.ExecuteRead(unit =>
            {
                using var command = unit.CreateCommand("SELECT COUNT(*) FROM harness_component_placements WHERE snapshot_id = $id;");
                command.Parameters.AddWithValue("$id", snapshot.SnapshotId.ToString("D"));
                return Convert.ToInt32(command.ExecuteScalar());
            });
            Assert.Equal(0, placements);
            databasePath = storage.Layout.DatabasePath;
        }

        var before = System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(databasePath));
        await using (var lease = DataRootLease.Acquire(fixture.SourceDataRoot))
        {
            var migration = new SqliteStorageMigrationService(lease);
            var result = await migration.MigrateIfRequiredAsync(new StorageMigrationRequest(
                Path.Combine(fixture.Root, "backups"), "0.45.1-m4-65", SqliteStorage.CurrentSchemaVersion),
                TestContext.Current.CancellationToken);
            Assert.False(result.Migrated);
            migration.CompleteSuccessfulStartup(result);
        }
        Assert.Equal(before, System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(databasePath)));
        using var backups = new SqliteStorageBackupService(fixture.SourceDataRoot, databasePath);
        var backup = await backups.CreateAsync(new StorageBackupRequest(
            Path.Combine(fixture.Root, "backups"), "0.45.1-m4-65"), TestContext.Current.CancellationToken);
        using var restore = new SqliteStorageRestoreService(fixture.SourceDataRoot, backups);
        await restore.DryRunAsync(new StorageDryRunRestoreRequest(backup.BackupPath, fixture.DestinationDataRoot),
            TestContext.Current.CancellationToken);
        using var restored = SqliteStorage.Open(fixture.DestinationDataRoot);
        var restoredSnapshot = Assert.Single(new SqliteProjectComponentSnapshotStore(restored, TimeProvider.System).ListSnapshots(projectId));
        Assert.Equal(JsonSerializer.Serialize(snapshot), JsonSerializer.Serialize(restoredSnapshot));
        Assert.Equal(before, System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(databasePath)));
    }

    [Fact]
    public async Task Startup_and_backup_still_reject_cross_project_component_ownership()
    {
        using var fixture = Fixture.Create();
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.SourceDataRoot))
        {
            var source = CreateSourceGraph(storage);
            var copy = new SqliteProjectCatalog(storage).CopyProject(source.ProjectId);
            storage.ExecuteInTransaction(unit =>
            {
                using var command = unit.CreateCommand("UPDATE harness_component_placements SET harness_id = $harness WHERE placement_id = $placement;");
                command.Parameters.AddWithValue("$harness", Assert.Single(copy.Harnesses).HarnessId.Value.ToString("D"));
                command.Parameters.AddWithValue("$placement", source.PlacementIds[0].ToString("D"));
                command.ExecuteNonQuery();
            });
            databasePath = storage.Layout.DatabasePath;
        }
        await using var lease = DataRootLease.Acquire(fixture.SourceDataRoot);
        var error = await Assert.ThrowsAsync<StorageMigrationException>(() =>
            new SqliteStorageMigrationService(lease).MigrateIfRequiredAsync(new StorageMigrationRequest(
                Path.Combine(fixture.Root, "backups"), "0.45.1-m4-65", SqliteStorage.CurrentSchemaVersion),
                TestContext.Current.CancellationToken));
        Assert.Contains("ownership graph", error.InnerException!.Message);
        using var backups = new SqliteStorageBackupService(fixture.SourceDataRoot, databasePath);
        await Assert.ThrowsAsync<StorageBackupException>(() => backups.CreateAsync(new StorageBackupRequest(
            Path.Combine(fixture.Root, "backups"), "0.45.1-m4-65"), TestContext.Current.CancellationToken));
    }

    private static SourceGraph CreateSourceGraph(SqliteStorage storage, int schemaVersion = 3)
    {
        var projects = new SqliteProjectCatalog(storage);
        var project = projects.CreateProject(new CreateProjectCommand(
            "P-PORTABLE", "Portable component graph", 1, ProjectStatus.Active));
        var harness = projects.AddHarness(project.ProjectId, "W1").Harnesses.Single();
        var article = ComponentTemplateContentV3ValidatorTests.ValidArticleBindings.Single();
        var template = new SqliteComponentTemplateStore(storage, TimeProvider.System).Create(
            "XH", "XH series", [article], schemaVersion,
            schemaVersion == 5 ? ComponentTemplateContentV5ValidatorTests.ValidContent().ToJsonString() : schemaVersion == 4
                ? ComponentTemplateContentV4ValidatorTests.ValidContentJson
                : ComponentTemplateContentV3ValidatorTests.ValidContentJson);
        var store = new SqliteProjectComponentSnapshotStore(storage, TimeProvider.System);
        var firstId = Guid.NewGuid();
        var secondId = Guid.NewGuid();
        var firstLogicalId = Guid.NewGuid();
        var secondLogicalId = Guid.NewGuid();
        var articleVariantId = Guid.NewGuid();
        var materialSnapshotId = Guid.NewGuid();
        var cableMaterialSnapshotId = Guid.NewGuid();
        var first = BoundInstance(firstId, firstLogicalId, articleVariantId, "X1", template, article);
        var second = BoundInstance(secondId, secondLogicalId, articleVariantId, "X2", template, article);

        _ = store.Place(project.ProjectId, harness.HarnessId, new ProjectCommandEnvelope(Guid.NewGuid(), 0),
            firstId, template, article.SourceId, article.EntityType, article.ArticleKey, first);
        _ = store.Place(project.ProjectId, harness.HarnessId, new ProjectCommandEnvelope(Guid.NewGuid(), 1),
            secondId, template, article.SourceId, article.EntityType, article.ArticleKey, second);

        var designs = new SqliteHarnessDesignDocumentStore(storage, TimeProvider.System);
        var design = designs.Get(project.ProjectId, harness.HarnessId);
        var content = JsonNode.Parse(design.ContentJson)!.AsObject();
        content["wires"]!.AsArray().Add(new JsonObject
        {
            ["id"] = "wire-1",
            ["circuit"] = "DATA+",
            ["materialBinding"] = new JsonObject
            {
                ["sourceId"] = "technology-wires",
                ["snapshotId"] = materialSnapshotId.ToString("D"),
                ["snapshotSha256"] = new string('a', 64),
                ["recordId"] = new string('b', 64),
                ["entityType"] = "wire",
                ["sourceKey"] = "UL1061-24-BK",
                ["displayName"] = "UL1061 24 AWG, чёрный",
            },
            ["stripProfiles"] = new JsonObject
            {
                ["from"] = StripProfile(
                    "4a98501d-b827-43d0-a324-629e02613d0b", 'c', 'd', "BNC|RG58|from",
                    "BNC / RG58, сторона X1",
                    (1, 0.901m, 2.501m), (3, 2.953m, 3.507m), (7, 4.957m, 7.509m)),
                ["to"] = StripProfile(
                    "c8584ef6-a77d-4f26-9e24-9e082dd3fbcc", 'e', 'f', "BNC|RG58|to",
                    "BNC / RG58, сторона X2",
                    (2, 1.103m, 1.207m), (5, 3.311m, 5.419m)),
            },
            ["lengthMm"] = 20.001m,
            ["endCorrectionFromMm"] = -0.001m,
            ["endCorrectionToMm"] = 0.002m,
            ["cutRoundingStepMm"] = 0.005m,
            ["from"] = new JsonObject
            {
                ["connectorId"] = firstId.ToString("D"),
                ["contactId"] = ContactId(firstId, firstLogicalId),
            },
            ["to"] = new JsonObject
            {
                ["connectorId"] = secondId.ToString("D"),
                ["contactId"] = ContactId(secondId, secondLogicalId),
            },
        });
        content["wires"]!.AsArray().Add(new JsonObject
        {
            ["id"] = "wire-2",
            ["circuit"] = "DATA-",
        });
        content["cables"] = new JsonArray(new JsonObject
        {
            ["id"] = "cable-1",
            ["memberWireIds"] = new JsonArray("wire-1", "wire-2"),
            ["materialBinding"] = new JsonObject
            {
                ["sourceId"] = "technology-cables",
                ["snapshotId"] = cableMaterialSnapshotId.ToString("D"),
                ["snapshotSha256"] = new string('1', 64),
                ["recordId"] = new string('2', 64),
                ["entityType"] = "cable",
                ["sourceKey"] = "CABLE-2X0.20",
                ["displayName"] = "Кабель 2x0,20",
            },
            ["lengthMm"] = 125.503m,
            ["sheathStrip"] = new JsonObject { ["fromMm"] = 10.125m, ["toMm"] = 20.5m },
            ["endCorrectionFromMm"] = -1.127m,
            ["endCorrectionToMm"] = 2.009m,
            ["cutRoundingStepMm"] = 0.005m,
        });
        _ = designs.Put(project.ProjectId, harness.HarnessId, 2,
            SqliteHarnessDesignDocumentStore.CurrentContentSchemaVersion, content.ToJsonString());

        return new SourceGraph(
            project.ProjectId, harness.HarnessId, [firstId, secondId],
            template.TemplateId, template.Version, template.VersionSha256,
            template.SchemaVersion, articleVariantId, [firstLogicalId, secondLogicalId],
            materialSnapshotId, cableMaterialSnapshotId);
    }

    private static string BoundInstance(
        Guid placementId,
        Guid logicalContactId,
        Guid articleVariantId,
        string designation,
        ComponentTemplateVersion template,
        ComponentTemplateArticleBinding article) => new JsonObject
    {
        ["id"] = placementId.ToString("D"),
        ["designation"] = designation,
        ["partNumber"] = article.ArticleKey,
        ["contacts"] = new JsonArray(new JsonObject
        {
            ["id"] = ContactId(placementId, logicalContactId),
            ["logicalContactId"] = logicalContactId.ToString("D"),
            ["number"] = 1,
        }),
        ["libraryBinding"] = new JsonObject
        {
            ["mode"] = "template",
            ["templateId"] = template.TemplateId.ToString("D"),
            ["templateVersion"] = template.Version,
            ["versionSha256"] = template.VersionSha256,
            ["articleVariantId"] = articleVariantId.ToString("D"),
            ["article"] = Article(article),
            ["snapshot"] = new JsonObject
            {
                ["templateId"] = template.TemplateId.ToString("D"),
                ["templateVersion"] = template.Version,
                ["versionSha256"] = template.VersionSha256,
                ["articleVariantId"] = articleVariantId.ToString("D"),
                ["article"] = Article(article),
                ["logicalContactId"] = logicalContactId.ToString("D"),
            },
        },
    }.ToJsonString();

    private static JsonObject Article(ComponentTemplateArticleBinding article) => new()
    {
        ["sourceId"] = article.SourceId,
        ["entityType"] = article.EntityType,
        ["articleKey"] = article.ArticleKey,
    };

    private static void AssertPortableGraph(
        SqliteStorage storage,
        ProjectIdentity projectId,
        HarnessIdentity harnessId,
        SourceGraph source)
    {
        var snapshotStore = new SqliteProjectComponentSnapshotStore(storage, TimeProvider.System);
        var placements = snapshotStore.ListPlacements(projectId, harnessId);
        Assert.Equal(2, placements.Count);
        Assert.Empty(placements.Select(item => item.PlacementId).Intersect(source.PlacementIds));
        Assert.All(placements, placement => Assert.NotEqual(Guid.Empty, placement.PlacementId));

        var snapshots = snapshotStore.ListSnapshots(projectId);
        var snapshot = Assert.Single(snapshots);
        Assert.Equal(source.TemplateId, snapshot.SourceTemplateId);
        Assert.Equal(source.TemplateVersion, snapshot.SourceVersion);
        Assert.Equal(source.VersionSha256, snapshot.SourceVersionSha256);
        Assert.Equal(source.SchemaVersion, snapshot.SchemaVersion);

        var design = new SqliteHarnessDesignDocumentStore(storage, TimeProvider.System)
            .Get(projectId, harnessId);
        using var document = JsonDocument.Parse(design.ContentJson);
        var connectors = document.RootElement.GetProperty("connectors").EnumerateArray().ToArray();
        var wires = document.RootElement.GetProperty("wires").EnumerateArray().ToArray();
        Assert.Equal(2, wires.Length);
        var wire = wires.Single(item => item.GetProperty("id").GetString() == "wire-1");
        Assert.Equal("wire-1", wire.GetProperty("id").GetString());
        Assert.Equal("DATA+", wire.GetProperty("circuit").GetString());
        Assert.Equal("DATA-", wires.Single(item => item.GetProperty("id").GetString() == "wire-2")
            .GetProperty("circuit").GetString());
        var material = wire.GetProperty("materialBinding");
        Assert.Equal("technology-wires", material.GetProperty("sourceId").GetString());
        Assert.Equal(source.MaterialSnapshotId.ToString("D"), material.GetProperty("snapshotId").GetString());
        Assert.Equal(new string('a', 64), material.GetProperty("snapshotSha256").GetString());
        Assert.Equal(new string('b', 64), material.GetProperty("recordId").GetString());
        Assert.Equal("wire", material.GetProperty("entityType").GetString());
        Assert.Equal("UL1061-24-BK", material.GetProperty("sourceKey").GetString());
        Assert.Equal("UL1061 24 AWG, чёрный", material.GetProperty("displayName").GetString());
        var stripProfiles = wire.GetProperty("stripProfiles");
        AssertStripProfile(
            stripProfiles.GetProperty("from"),
            "4a98501d-b827-43d0-a324-629e02613d0b", 'c', 'd', "BNC|RG58|from",
            "BNC / RG58, сторона X1",
            (1, 0.901m, 2.501m), (3, 2.953m, 3.507m), (7, 4.957m, 7.509m));
        AssertStripProfile(
            stripProfiles.GetProperty("to"),
            "c8584ef6-a77d-4f26-9e24-9e082dd3fbcc", 'e', 'f', "BNC|RG58|to",
            "BNC / RG58, сторона X2",
            (2, 1.103m, 1.207m), (5, 3.311m, 5.419m));
        Assert.Equal(20.001m, wire.GetProperty("lengthMm").GetDecimal());
        Assert.Equal(-0.001m, wire.GetProperty("endCorrectionFromMm").GetDecimal());
        Assert.Equal(0.002m, wire.GetProperty("endCorrectionToMm").GetDecimal());
        Assert.Equal(0.005m, wire.GetProperty("cutRoundingStepMm").GetDecimal());
        var cable = Assert.Single(document.RootElement.GetProperty("cables").EnumerateArray());
        Assert.Equal("cable-1", cable.GetProperty("id").GetString());
        Assert.Equal(["wire-1", "wire-2"], cable.GetProperty("memberWireIds").EnumerateArray()
            .Select(item => item.GetString()).ToArray());
        var cableMaterial = cable.GetProperty("materialBinding");
        Assert.Equal("technology-cables", cableMaterial.GetProperty("sourceId").GetString());
        Assert.Equal(source.CableMaterialSnapshotId.ToString("D"), cableMaterial.GetProperty("snapshotId").GetString());
        Assert.Equal(new string('1', 64), cableMaterial.GetProperty("snapshotSha256").GetString());
        Assert.Equal(new string('2', 64), cableMaterial.GetProperty("recordId").GetString());
        Assert.Equal("cable", cableMaterial.GetProperty("entityType").GetString());
        Assert.Equal("CABLE-2X0.20", cableMaterial.GetProperty("sourceKey").GetString());
        Assert.Equal("Кабель 2x0,20", cableMaterial.GetProperty("displayName").GetString());
        Assert.Equal(125.503m, cable.GetProperty("lengthMm").GetDecimal());
        Assert.Equal(10.125m, cable.GetProperty("sheathStrip").GetProperty("fromMm").GetDecimal());
        Assert.Equal(20.5m, cable.GetProperty("sheathStrip").GetProperty("toMm").GetDecimal());
        Assert.Equal(-1.127m, cable.GetProperty("endCorrectionFromMm").GetDecimal());
        Assert.Equal(2.009m, cable.GetProperty("endCorrectionToMm").GetDecimal());
        Assert.Equal(0.005m, cable.GetProperty("cutRoundingStepMm").GetDecimal());
        var destinationIds = placements.Select(item => item.PlacementId.ToString("D")).ToHashSet(StringComparer.Ordinal);
        Assert.Equal(destinationIds, connectors.Select(item => item.GetProperty("id").GetString()!).ToHashSet(StringComparer.Ordinal));

        foreach (var placement in placements)
        {
            var connector = connectors.Single(item =>
                item.GetProperty("id").GetString() == placement.PlacementId.ToString("D"));
            using var instance = JsonDocument.Parse(placement.InstanceJson);
            Assert.True(JsonElement.DeepEquals(connector, instance.RootElement));
            var binding = connector.GetProperty("libraryBinding");
            Assert.Equal(source.TemplateId.ToString("D"), binding.GetProperty("templateId").GetString());
            Assert.Equal(source.VersionSha256, binding.GetProperty("versionSha256").GetString());
            Assert.Equal(source.ArticleVariantId.ToString("D"), binding.GetProperty("articleVariantId").GetString());
            var logicalId = connector.GetProperty("contacts")[0].GetProperty("logicalContactId").GetString();
            Assert.Contains(Guid.Parse(logicalId!), source.LogicalContactIds);
            Assert.Equal(
                ContactId(placement.PlacementId, Guid.Parse(logicalId!)),
                connector.GetProperty("contacts")[0].GetProperty("id").GetString());
        }

        foreach (var endName in new[] { "from", "to" })
        {
            var endpoint = wire.GetProperty(endName);
            var connectorId = endpoint.GetProperty("connectorId").GetString()!;
            Assert.Contains(connectorId, destinationIds);
            Assert.StartsWith(connectorId + ":contact:", endpoint.GetProperty("contactId").GetString());
        }
    }

    private static string ContactId(Guid placementId, Guid logicalContactId) =>
        $"{placementId:D}:contact:{logicalContactId:D}";

    private static JsonObject StripProfile(
        string snapshotId,
        char snapshotHashCharacter,
        char recordHashCharacter,
        string sourceKey,
        string displayName,
        params (int Index, decimal DiameterMm, decimal StripLengthMm)[] layers) => new()
    {
        ["sourceId"] = "technology-coax-terminations",
        ["snapshotId"] = snapshotId,
        ["snapshotSha256"] = new string(snapshotHashCharacter, 64),
        ["recordId"] = new string(recordHashCharacter, 64),
        ["entityType"] = "coax-termination",
        ["sourceKey"] = sourceKey,
        ["displayName"] = displayName,
        ["layers"] = new JsonArray(layers.Select(layer => new JsonObject
        {
            ["index"] = layer.Index,
            ["diameterMm"] = layer.DiameterMm,
            ["stripLengthMm"] = layer.StripLengthMm,
        }).ToArray()),
    };

    private static void AssertStripProfile(
        JsonElement actual,
        string snapshotId,
        char snapshotHashCharacter,
        char recordHashCharacter,
        string sourceKey,
        string displayName,
        params (int Index, decimal DiameterMm, decimal StripLengthMm)[] layers)
    {
        Assert.Equal("technology-coax-terminations", actual.GetProperty("sourceId").GetString());
        Assert.Equal(snapshotId, actual.GetProperty("snapshotId").GetString());
        Assert.Equal(new string(snapshotHashCharacter, 64), actual.GetProperty("snapshotSha256").GetString());
        Assert.Equal(new string(recordHashCharacter, 64), actual.GetProperty("recordId").GetString());
        Assert.Equal("coax-termination", actual.GetProperty("entityType").GetString());
        Assert.Equal(sourceKey, actual.GetProperty("sourceKey").GetString());
        Assert.Equal(displayName, actual.GetProperty("displayName").GetString());
        var actualLayers = actual.GetProperty("layers").EnumerateArray().ToArray();
        Assert.Equal(layers.Length, actualLayers.Length);
        for (var index = 0; index < layers.Length; index++)
        {
            Assert.Equal(layers[index].Index, actualLayers[index].GetProperty("index").GetInt32());
            Assert.Equal(layers[index].DiameterMm, actualLayers[index].GetProperty("diameterMm").GetDecimal());
            Assert.Equal(layers[index].StripLengthMm, actualLayers[index].GetProperty("stripLengthMm").GetDecimal());
        }
    }

    private sealed record SourceGraph(
        ProjectIdentity ProjectId,
        HarnessIdentity HarnessId,
        IReadOnlyList<Guid> PlacementIds,
        Guid TemplateId,
        int TemplateVersion,
        string VersionSha256,
        int SchemaVersion,
        Guid ArticleVariantId,
        IReadOnlyList<Guid> LogicalContactIds,
        Guid MaterialSnapshotId,
        Guid CableMaterialSnapshotId);

    private sealed class Fixture : IDisposable
    {
        private Fixture(string root)
        {
            Root = root;
            SourceDataRoot = Path.Combine(root, "source");
            DestinationDataRoot = Path.Combine(root, "destination");
            ArchivePath = Path.Combine(root, "portable.techmap-project.zip");
            Directory.CreateDirectory(root);
        }

        public string Root { get; }
        public string SourceDataRoot { get; }
        public string DestinationDataRoot { get; }
        public string ArchivePath { get; }

        public static Fixture Create() => new(Path.Combine(
            Path.GetTempPath(), "techmap-m3-portability-" + Guid.NewGuid().ToString("N")));

        public void Dispose()
        {
            if (Directory.Exists(Root)) Directory.Delete(Root, true);
        }
    }
}
