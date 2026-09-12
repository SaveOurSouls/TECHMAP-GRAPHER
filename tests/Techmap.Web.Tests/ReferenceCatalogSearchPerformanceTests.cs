using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ReferenceCatalogSearchPerformanceTests(ITestOutputHelper output)
{
    private const int RecordCount = 50_000;

    [Fact]
    [Trait("Category", "Performance")]
    public async Task Fifty_thousand_record_catalog_meets_search_budget()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-search-performance", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var storage = SqliteStorage.Open(root);
            var publicationWatch = Stopwatch.StartNew();
            Publish(storage, BuildRecords());
            publicationWatch.Stop();
            var store = new SqliteReferenceCatalogSearchStore(storage);
            var queryPlans = ReadQueryPlans(storage);
            Assert.Contains("ix_reference_search_records_key", queryPlans["exact-key"], StringComparison.Ordinal);
            Assert.Contains("ix_reference_search_fields_text", queryPlans["field-eq"], StringComparison.Ordinal);
            var scenarios = new Dictionary<string, (ReferenceCatalogSearchQuery Query, ReferenceCatalogSearchPosition? After)>
            {
                ["empty"] = (Query(), null),
                ["exact-key"] = (Query(exactSourceKey: "DEMO-049999"), null),
                ["full-text"] = (Query(text: "провод серия 42"), null),
                ["field-eq"] = (Query(filters:
                    [new("series", ReferenceCatalogFilterOperator.TextEquals, "42")]), null),
                ["field-prefix"] = (Query(filters:
                    [new("name", ReferenceCatalogFilterOperator.TextPrefix, "Провод серия")]), null),
                ["filter-all"] = (Query(filters:
                [
                    new("series", ReferenceCatalogFilterOperator.TextEquals, "42"),
                    new("color", ReferenceCatalogFilterOperator.TextEquals, "красный"),
                ]), null),
                ["filter-any"] = (Query(filters:
                [
                    new("series", ReferenceCatalogFilterOperator.TextEquals, "42"),
                    new("series", ReferenceCatalogFilterOperator.TextEquals, "43"),
                ], logic: ReferenceCatalogFilterLogic.Any), null),
                ["no-match"] = (Query(text: "несуществующий"), null),
                ["late-keyset"] = (Query(), new ReferenceCatalogSearchPosition(
                    0, "DEMO-049000", "DEMO-049000", "wire")),
            };

            var all = new List<double>();
            var reportScenarios = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (var scenario in scenarios)
            {
                for (var index = 0; index < 5; index++)
                    await ExecuteAsync(store, scenario.Value.Query, scenario.Value.After);
                var timings = new List<double>();
                for (var index = 0; index < 30; index++)
                {
                    var watch = Stopwatch.StartNew();
                    await ExecuteAsync(store, scenario.Value.Query, scenario.Value.After);
                    watch.Stop();
                    timings.Add(watch.Elapsed.TotalMilliseconds);
                }

                timings.Sort();
                all.AddRange(timings);
                reportScenarios[scenario.Key] = new
                {
                    samples = timings.Count,
                    p50Milliseconds = Percentile(timings, 0.50),
                    p95Milliseconds = Percentile(timings, 0.95),
                    maxMilliseconds = timings[^1],
                };
                output.WriteLine(
                    "{0}: p50={1:F2} ms, p95={2:F2} ms, max={3:F2} ms",
                    scenario.Key, Percentile(timings, 0.50), Percentile(timings, 0.95), timings[^1]);
            }

            all.Sort();
            var p95 = Percentile(all, 0.95);
            var max = all[^1];
            WriteReport(new
            {
                schema = 1,
                measuredUtc = DateTimeOffset.UtcNow,
                environment = new
                {
                    operatingSystem = Environment.OSVersion.ToString(),
                    framework = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
                    architecture = System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture.ToString(),
                    processorCount = Environment.ProcessorCount,
                },
                catalog = new
                {
                    recordCount = RecordCount,
                    publicationMilliseconds = publicationWatch.Elapsed.TotalMilliseconds,
                },
                method = "5 warmups and 30 measured async SQLite calls per scenario",
                scenarios = reportScenarios,
                queryPlans,
                aggregate = new { p95Milliseconds = p95, maxMilliseconds = max },
                budget = new { p95Milliseconds = 100, maxMilliseconds = 200 },
            });
            output.WriteLine(
                "publication={0:F2} s; aggregate p95={1:F2} ms, max={2:F2} ms",
                publicationWatch.Elapsed.TotalSeconds, p95, max);
            Assert.True(p95 <= 100, $"Search p95 {p95:F2} ms exceeds 100 ms.");
            Assert.True(max <= 200, $"Search max {max:F2} ms exceeds 200 ms.");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private static IReadOnlyList<ReferenceCatalogRecordInput> BuildRecords()
    {
        var records = new ReferenceCatalogRecordInput[RecordCount];
        for (var index = 0; index < records.Length; index++)
        {
            var ordinal = index + 1;
            var type = (index % 4) switch
            {
                0 => "wire",
                1 => "terminal",
                2 => "connector",
                _ => "accessory",
            };
            var typeName = (index % 4) switch
            {
                0 => "Провод",
                1 => "Терминал",
                2 => "Соединитель",
                _ => "Аксессуар",
            };
            var color = index % 2 == 0 ? "красный" : "чёрный";
            var payload = JsonSerializer.SerializeToElement(new
            {
                name = $"{typeName} серия {index % 101}",
                series = (index % 101).ToString(CultureInfo.InvariantCulture),
                color,
                section = new[] { "0.14", "0.25", "0.5", "0.75", "1", "1.5" }[index % 6],
            });
            var key = $"DEMO-{ordinal:000000}";
            records[index] = new ReferenceCatalogRecordInput(type, key, payload, $"Catalog!{ordinal + 1}");
        }
        return records;
    }

    private static void Publish(SqliteStorage storage, IReadOnlyList<ReferenceCatalogRecordInput> records)
    {
        var validation = ReferenceCatalogDraft.Create(
            ReferenceCatalogSnapshotIdentity.New(),
            "technology-database",
            1,
            new DateTimeOffset(2026, 9, 13, 0, 0, 0, TimeSpan.Zero),
            new ReferenceCatalogProvenanceInput("synthetic", "m2-03-50000", "generated"),
            records).Validate();
        var result = new ReferenceCatalogPublicationService(
            new SqliteReferenceCatalogSnapshotStore(storage)).Publish(
            new ReferenceCatalogPublicationRequest(validation, null, validation.Snapshot!.Sha256, []));
        Assert.Equal(ReferenceCatalogPublicationStatus.Published, result.Status);
    }

    private static ReferenceCatalogSearchQuery Query(
        string? text = null,
        string? exactSourceKey = null,
        IReadOnlyList<ReferenceCatalogFilterCondition>? filters = null,
        ReferenceCatalogFilterLogic logic = ReferenceCatalogFilterLogic.All) => new(
        text,
        exactSourceKey,
        [],
        filters ?? [],
        logic,
        ReferenceCatalogSort.SourceKeyAscending,
        40);

    private static async Task ExecuteAsync(
        IReferenceCatalogSearchStore store,
        ReferenceCatalogSearchQuery query,
        ReferenceCatalogSearchPosition? after)
    {
        await store.SearchAsync(
            "technology-database", null, query, after, TestContext.Current.CancellationToken);
    }

    private static double Percentile(IReadOnlyList<double> sorted, double percentile) =>
        sorted[Math.Max(0, (int)Math.Ceiling(sorted.Count * percentile) - 1)];

    private static IReadOnlyDictionary<string, string> ReadQueryPlans(SqliteStorage storage) =>
        storage.ExecuteRead(unitOfWork => new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["exact-key"] = Explain(unitOfWork,
                """
                SELECT search_id FROM reference_search_records
                WHERE source_id = (SELECT source_id FROM reference_sources WHERE source_key = 'technology-database')
                  AND normalized_source_key = 'DEMO-049999';
                """),
            ["field-eq"] = Explain(unitOfWork,
                """
                SELECT search_id FROM reference_search_fields
                WHERE source_id = (SELECT source_id FROM reference_sources WHERE source_key = 'technology-database')
                  AND field_name = 'SERIES' AND normalized_text = '42';
                """),
        });

    private static string Explain(SqliteUnitOfWork unitOfWork, string sql)
    {
        using var command = unitOfWork.CreateCommand("EXPLAIN QUERY PLAN " + sql);
        using var reader = command.ExecuteReader();
        var lines = new List<string>();
        while (reader.Read()) lines.Add(reader.GetString(3));
        return string.Join(" | ", lines);
    }

    private static void WriteReport(object report)
    {
        var repository = new DirectoryInfo(AppContext.BaseDirectory);
        while (repository is not null && !File.Exists(Path.Combine(repository.FullName, "Techmap-Grapher.slnx")))
            repository = repository.Parent;
        if (repository is null) return;
        var directory = Path.Combine(repository.FullName, "artifacts", "m2-03");
        Directory.CreateDirectory(directory);
        File.WriteAllText(
            Path.Combine(directory, "search-performance.json"),
            JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
    }
}
