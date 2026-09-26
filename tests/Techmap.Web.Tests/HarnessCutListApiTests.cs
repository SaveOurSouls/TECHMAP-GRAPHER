using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Contracts;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class HarnessCutListApiTests
{
    private const string Origin = "http://127.0.0.1:18762";

    [Theory]
    [InlineData("missing", "route_cut_not_prepared")]
    [InlineData("stale", "route_source_stale")]
    [InlineData("strip-only", "route_cut_not_prepared")]
    [InlineData("unprepared", "route_cut_not_prepared")]
    [InlineData("unbound", "route_cut_not_prepared")]
    public async Task Direct_cut_api_cannot_bypass_route_preparation(string mutation, string expectedError)
    {
        await using var factory = new TechmapWebApplicationFactory(); using var client = factory.CreateLocalClient();
        var csrf=await StartSessionAsync(client);var ids=await CreateHarnessAsync(client,csrf);
        var content=JsonSerializer.SerializeToElement(new { schemaVersion=1,connectors=Array.Empty<object>(),wires=new[]{new{id="w",circuit="",lengthMm=100}} });
        var ready=JsonNode.Parse(PreparedCutRouteFixture.Add(content,1).GetRawText())!;
        var route=ready["manufacturingRoute"]!;
        if(mutation=="missing")ready.AsObject().Remove("manufacturingRoute");
        if(mutation=="strip-only")route["rows"]![0]!["operations"]![0]!["mode"]="strip-both";
        if(mutation=="unprepared")route["rows"]![0]!["prepared"]=false;
        if(mutation=="unbound")route["rows"]![0]!["operations"]![0]!["binding"]=null;
        using var save=await SendAsync(client,HttpMethod.Put,DesignRoute(ids.ProjectId,ids.HarnessId),new PutHarnessDesignRequest(0,1,JsonSerializer.SerializeToElement(ready),2),csrf);
        Assert.True(save.IsSuccessStatusCode,await save.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        if(mutation=="stale")
        {
            ready["wires"]![0]!["lengthMm"]=101;
            using var changed=await SendAsync(client,HttpMethod.Put,DesignRoute(ids.ProjectId,ids.HarnessId),new PutHarnessDesignRequest(1,1,JsonSerializer.SerializeToElement(ready),2),csrf);
            Assert.True(changed.IsSuccessStatusCode,await changed.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        }
        using var result=await client.GetAsync(CutListRoute(ids.ProjectId,ids.HarnessId),TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest,result.StatusCode);
        var error=await result.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken);
        Assert.Equal(expectedError,error!.Error);Assert.Contains("Карта резки недоступна",error.Message!);
    }

    [Fact]
    public async Task Covering_cut_uses_measured_mm_and_dimension_changes_invalidate_the_route()
    {
        await using var factory=new TechmapWebApplicationFactory();using var client=factory.CreateLocalClient();
        var csrf=await StartSessionAsync(client);var ids=await CreateHarnessAsync(client,csrf,quantity:3);
        using var original=JsonDocument.Parse("""
        {"schemaVersion":1,"connectors":[],"wires":[],"drawingDocuments":{"tables":[],"leaders":[],"bomOrder":[],"dimensions":[{"id":"D","segmentId":"S","from":0,"to":1,"pointCount":2,"routeKey":"[\"S\",\"N1\",\"N2\",0]","mode":"path","offset":40,"lengthMm":120.125}]},
        "physicalTopology":{"snap":false,"nodes":[{"id":"N1","position":{"x":0,"y":0}},{"id":"N2","position":{"x":9999,"y":0}}],"segments":[{"id":"S","from":"N1","to":"N2","bends":[]}],"routes":[],"coverings":[{"id":"C","name":"Оплётка","kind":"braid","lengthMode":"auto","width":20,"color":"#334455","lengthMm":null,"spans":[{"segmentId":"S","from":0,"to":1,"fromAnchor":0,"toAnchor":1}]}]}}
        """);
        var ready=JsonNode.Parse(PreparedCutRouteFixture.Add(original.RootElement,3).GetRawText())!;
        using var save=await SendAsync(client,HttpMethod.Put,DesignRoute(ids.ProjectId,ids.HarnessId),new PutHarnessDesignRequest(0,1,JsonSerializer.SerializeToElement(ready),2),csrf);
        Assert.True(save.IsSuccessStatusCode,await save.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        var cut=(await client.GetFromJsonAsync<HarnessCutListResponse>(CutListRoute(ids.ProjectId,ids.HarnessId),TestContext.Current.CancellationToken))!;
        var covering=Assert.Single(cut.Items);Assert.Equal("covering",covering.SourceKind);Assert.Equal("C",covering.WireId);Assert.Equal(120.125m,covering.CutLengthMm);Assert.Equal(.360375m,covering.TotalMetres);
        ready["drawingDocuments"]!["dimensions"]![0]!["lengthMm"]=121.125m;
        using var changed=await SendAsync(client,HttpMethod.Put,DesignRoute(ids.ProjectId,ids.HarnessId),new PutHarnessDesignRequest(1,1,JsonSerializer.SerializeToElement(ready),2),csrf);
        Assert.True(changed.IsSuccessStatusCode,await changed.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        using var stale=await client.GetAsync(CutListRoute(ids.ProjectId,ids.HarnessId),TestContext.Current.CancellationToken);
        Assert.Equal("route_source_stale",(await stale.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken))!.Error);
        ready["manufacturingRoute"]!["rows"]=new JsonArray();
        var current=(await client.GetFromJsonAsync<HarnessDesignResponse>(DesignRoute(ids.ProjectId,ids.HarnessId),TestContext.Current.CancellationToken))!;
        ready["manufacturingRoute"]!["source"]!["sha256"]=current.SourceFingerprint;
        using var omitted=await SendAsync(client,HttpMethod.Put,DesignRoute(ids.ProjectId,ids.HarnessId),new PutHarnessDesignRequest(2,1,JsonSerializer.SerializeToElement(ready),2),csrf);
        Assert.True(omitted.IsSuccessStatusCode,await omitted.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        using var blocked=await client.GetAsync(CutListRoute(ids.ProjectId,ids.HarnessId),TestContext.Current.CancellationToken);
        Assert.Equal("route_cut_not_prepared",(await blocked.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken))!.Error);
    }

    [Fact]
    public async Task Cut_list_uses_exact_decimal_lengths_defaults_and_harness_quantity()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var ids = await CreateHarnessAsync(client, csrf, quantity: 3);
        using var content = JsonDocument.Parse(
            """
            {
              "schemaVersion": 1,
              "connectors": [],
              "wires": [
                {
                  "id": "W-1",
                  "circuit": "DATA+",
                  "lengthMm": 20.001,
                  "endCorrectionFromMm": -0.001,
                  "endCorrectionToMm": 0.002,
                  "cutRoundingStepMm": 0.005
                },
                {
                  "id": "W-2",
                  "circuit": "SPARE",
                  "lengthMm": null
                }
              ],
              "views": {"e4":{"layers":[]},"drawing":{"layers":[]}}
            }
            """);
        using (var save = await SendAsync(
                   client, HttpMethod.Put, DesignRoute(ids.ProjectId, ids.HarnessId),
                   new PutHarnessDesignRequest(0, 1, content.RootElement.Clone()), csrf))
        {
            Assert.Equal(HttpStatusCode.OK, save.StatusCode);
        }

        await PrepareCutRouteAsync(client, csrf, ids.ProjectId, ids.HarnessId);
        using var response = await client.GetAsync(
            CutListRoute(ids.ProjectId, ids.HarnessId), TestContext.Current.CancellationToken);
        var rawJson = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        var result = JsonSerializer.Deserialize<HarnessCutListResponse>(
            rawJson,
            new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"sourceLengthMm\":20.001", rawJson, StringComparison.Ordinal);
        Assert.Contains("\"roundingStepMm\":0.005", rawJson, StringComparison.Ordinal);
        Assert.Equal(ids.ProjectId, Assert.IsType<HarnessCutListResponse>(result).ProjectId);
        Assert.Equal(ids.HarnessId, result.HarnessId);
        Assert.Equal(3, result.HarnessQuantity);
        Assert.Equal("incomplete", result.Status);
        Assert.Contains("не закреплён", result.Warning, StringComparison.OrdinalIgnoreCase);

        var ready = result.Items[0];
        Assert.Equal("W-1", ready.WireId);
        Assert.Equal("DATA+", ready.Circuit);
        Assert.Equal("not-pinned", ready.Material);
        Assert.Null(ready.MaterialSourceKey);
        Assert.Null(ready.MaterialDisplayName);
        Assert.Equal(20.001m, ready.SourceLengthMm);
        Assert.Equal(-0.001m, ready.EndCorrectionFromMm);
        Assert.Equal(0.002m, ready.EndCorrectionToMm);
        Assert.Equal(0.005m, ready.RoundingStepMm);
        Assert.Equal(20.005m, ready.CutLengthMm);
        Assert.Equal(3, ready.Pieces);
        Assert.Equal(0.060015m, ready.TotalMetres);
        Assert.Equal("ready", ready.Status);
        Assert.Equal(["material-missing"], ready.Warnings);

        var incomplete = result.Items[1];
        Assert.Equal("W-2", incomplete.WireId);
        Assert.Null(incomplete.SourceLengthMm);
        Assert.Equal(0m, incomplete.EndCorrectionFromMm);
        Assert.Equal(0m, incomplete.EndCorrectionToMm);
        Assert.Equal(1m, incomplete.RoundingStepMm);
        Assert.Null(incomplete.CutLengthMm);
        Assert.Equal(3, incomplete.Pieces);
        Assert.Null(incomplete.TotalMetres);
        Assert.Equal("incomplete", incomplete.Status);
        Assert.Equal(
            ["material-missing", "length-missing"],
            incomplete.Warnings);
    }

    [Fact]
    public async Task Cut_list_uses_pinned_material_identity_and_reports_no_warning_for_a_complete_wire()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var ids = await CreateHarnessAsync(client, csrf, quantity: 4);
        var snapshotId = Guid.NewGuid();
        using var content = JsonDocument.Parse(
            """
            {
              "schemaVersion": 1,
              "connectors": [],
              "wires": [{
                "id": "W-MATERIAL",
                "circuit": "24V",
                "materialBinding": {
                  "sourceId": "technology-wires",
                  "snapshotId": "SNAPSHOT_ID",
                  "snapshotSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  "recordId": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                  "entityType": "wire",
                  "sourceKey": "UL1061-24-BK",
                  "displayName": "UL1061 24 AWG, чёрный"
                },
                "lengthMm": 125.2,
                "endCorrectionFromMm": 1.1,
                "endCorrectionToMm": 1.2,
                "cutRoundingStepMm": 1
              }],
              "views": {"e4":{"layers":[]},"drawing":{"layers":[]}}
            }
            """.Replace("SNAPSHOT_ID", snapshotId.ToString("D"), StringComparison.Ordinal));
        using (var save = await SendAsync(
                   client, HttpMethod.Put, DesignRoute(ids.ProjectId, ids.HarnessId),
                   new PutHarnessDesignRequest(0, 1, content.RootElement.Clone()), csrf))
        {
            Assert.Equal(HttpStatusCode.OK, save.StatusCode);
        }

        await PrepareCutRouteAsync(client, csrf, ids.ProjectId, ids.HarnessId);
        using var response = await client.GetAsync(
            CutListRoute(ids.ProjectId, ids.HarnessId), TestContext.Current.CancellationToken);
        var result = await response.Content.ReadFromJsonAsync<HarnessCutListResponse>(
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var cutList = Assert.IsType<HarnessCutListResponse>(result);
        Assert.Equal("ready", cutList.Status);
        Assert.Equal(string.Empty, cutList.Warning);
        var item = Assert.Single(cutList.Items);
        Assert.Equal("UL1061 24 AWG, чёрный", item.Material);
        Assert.Equal("UL1061-24-BK", item.MaterialSourceKey);
        Assert.Equal("UL1061 24 AWG, чёрный", item.MaterialDisplayName);
        Assert.Equal(125.2m, item.SourceLengthMm);
        Assert.Equal(128m, item.CutLengthMm);
        Assert.Equal(4, item.Pieces);
        Assert.Equal(0.512m, item.TotalMetres);
        Assert.Equal("ready", item.Status);
        Assert.Empty(item.Warnings);
    }

    [Fact]
    public async Task Cut_list_keeps_a_missing_length_null_with_an_explicit_warning()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var ids = await CreateHarnessAsync(client, csrf, quantity: 2);
        var snapshotId = Guid.NewGuid();
        using var content = JsonDocument.Parse(
            """
            {"schemaVersion":1,"connectors":[],"wires":[{
              "id":"W-NO-LENGTH","circuit":"",
              "materialBinding":{
                "sourceId":"technology-wires","snapshotId":"SNAPSHOT_ID",
                "snapshotSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "recordId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "entityType":"cable","sourceKey":"CABLE-2X","displayName":"Кабель 2x0,2"
              },"lengthMm":null
            }],"views":{"e4":{"layers":[]},"drawing":{"layers":[]}}}
            """.Replace("SNAPSHOT_ID", snapshotId.ToString("D"), StringComparison.Ordinal));
        using (var save = await SendAsync(
                   client, HttpMethod.Put, DesignRoute(ids.ProjectId, ids.HarnessId),
                   new PutHarnessDesignRequest(0, 1, content.RootElement.Clone()), csrf))
        {
            Assert.Equal(HttpStatusCode.OK, save.StatusCode);
        }

        await PrepareCutRouteAsync(client, csrf, ids.ProjectId, ids.HarnessId);
        using var response = await client.GetAsync(
            CutListRoute(ids.ProjectId, ids.HarnessId), TestContext.Current.CancellationToken);
        var result = await response.Content.ReadFromJsonAsync<HarnessCutListResponse>(
            TestContext.Current.CancellationToken);

        var cutList = Assert.IsType<HarnessCutListResponse>(result);
        Assert.Equal("incomplete", cutList.Status);
        Assert.Equal("Не указана конечная длина провода.", cutList.Warning);
        var item = Assert.Single(cutList.Items);
        Assert.Equal("CABLE-2X", item.MaterialSourceKey);
        Assert.Null(item.SourceLengthMm);
        Assert.Null(item.CutLengthMm);
        Assert.Null(item.TotalMetres);
        Assert.Equal(2, item.Pieces);
        Assert.Equal(["length-missing"], item.Warnings);
    }

    [Fact]
    public async Task Cut_list_counts_a_multicore_cable_once_and_omits_its_member_wires()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var ids = await CreateHarnessAsync(client, csrf, quantity: 2);
        var snapshotId = Guid.NewGuid().ToString("D");
        using var content = JsonDocument.Parse(
            """
            {
              "schemaVersion": 1,
              "connectors": [],
              "wires": [
                {"id":"W-C1","circuit":"DATA+","lengthMm":500},
                {"id":"W-C2","circuit":"DATA-","lengthMm":500},
                {
                  "id":"W-FREE","circuit":"24V","lengthMm":25,
                  "materialBinding":{
                    "sourceId":"technology-wires","snapshotId":"SNAPSHOT_ID",
                    "snapshotSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "recordId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    "entityType":"wire","sourceKey":"WIRE-FREE","displayName":"Отдельный провод"
                  }
                }
              ],
              "cables": [{
                "id":"C-1","memberWireIds":["W-C1","W-C2"],
                "materialBinding":{
                  "sourceId":"technology-cables","snapshotId":"SNAPSHOT_ID",
                  "snapshotSha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                  "recordId":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                  "entityType":"cable","sourceKey":"CABLE-2X","displayName":"Кабель 2x0,2"
                },
                "lengthMm":99.1,"endCorrectionFromMm":1,"endCorrectionToMm":2,
                "sheathStrip":{"fromMm":10,"toMm":20},
                "cutRoundingStepMm":1
              }],
              "views":{"e4":{"layers":[]},"drawing":{"layers":[]}}
            }
            """.Replace("SNAPSHOT_ID", snapshotId, StringComparison.Ordinal));
        using (var save = await SendAsync(
                   client, HttpMethod.Put, DesignRoute(ids.ProjectId, ids.HarnessId),
                   new PutHarnessDesignRequest(0, 1, content.RootElement.Clone()), csrf))
        {
            Assert.Equal(HttpStatusCode.OK, save.StatusCode);
        }

        await PrepareCutRouteAsync(client, csrf, ids.ProjectId, ids.HarnessId);
        using var response = await client.GetAsync(
            CutListRoute(ids.ProjectId, ids.HarnessId), TestContext.Current.CancellationToken);
        var result = await response.Content.ReadFromJsonAsync<HarnessCutListResponse>(
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var cutList = Assert.IsType<HarnessCutListResponse>(result);
        Assert.Equal("ready", cutList.Status);
        Assert.Equal(2, cutList.Items.Count);
        var cable = Assert.Single(cutList.Items, item => item.WireId == "C-1");
        Assert.Equal("CABLE-2X", cable.MaterialSourceKey);
        Assert.Equal(99.1m, cable.SourceLengthMm);
        Assert.Equal(103m, cable.CutLengthMm);
        Assert.Equal(2, cable.Pieces);
        Assert.Equal(0.206m, cable.TotalMetres);
        Assert.DoesNotContain(cutList.Items, item => item.WireId is "W-C1" or "W-C2");
        var ordinaryWire = Assert.Single(cutList.Items, item => item.WireId == "W-FREE");
        Assert.Equal("WIRE-FREE", ordinaryWire.MaterialSourceKey);
        Assert.Equal(0.05m, ordinaryWire.TotalMetres);
    }

    [Fact]
    public async Task Cut_list_marks_a_cable_with_unknown_length_incomplete_without_counting_its_members()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var ids = await CreateHarnessAsync(client, csrf, quantity: 3);
        var snapshotId = Guid.NewGuid().ToString("D");
        using var content = JsonDocument.Parse(
            """
            {
              "schemaVersion":1,"connectors":[],
              "wires":[
                {"id":"W-1","circuit":"A","lengthMm":50},
                {"id":"W-2","circuit":"B","lengthMm":50}
              ],
              "cables":[{
                "id":"C-UNKNOWN","memberWireIds":["W-1","W-2"],"lengthMm":null,
                "materialBinding":{
                  "sourceId":"technology-cables","snapshotId":"SNAPSHOT_ID",
                  "snapshotSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  "recordId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                  "entityType":"cable","sourceKey":"CABLE-X","displayName":"Кабель X"
                }
              }],
              "views":{"e4":{"layers":[]},"drawing":{"layers":[]}}
            }
            """.Replace("SNAPSHOT_ID", snapshotId, StringComparison.Ordinal));
        using (var save = await SendAsync(
                   client, HttpMethod.Put, DesignRoute(ids.ProjectId, ids.HarnessId),
                   new PutHarnessDesignRequest(0, 1, content.RootElement.Clone()), csrf))
        {
            Assert.Equal(HttpStatusCode.OK, save.StatusCode);
        }

        await PrepareCutRouteAsync(client, csrf, ids.ProjectId, ids.HarnessId);
        using var response = await client.GetAsync(
            CutListRoute(ids.ProjectId, ids.HarnessId), TestContext.Current.CancellationToken);
        var result = await response.Content.ReadFromJsonAsync<HarnessCutListResponse>(
            TestContext.Current.CancellationToken);

        var cutList = Assert.IsType<HarnessCutListResponse>(result);
        Assert.Equal("incomplete", cutList.Status);
        var cable = Assert.Single(cutList.Items);
        Assert.Equal("C-UNKNOWN", cable.WireId);
        Assert.Null(cable.CutLengthMm);
        Assert.Null(cable.TotalMetres);
        Assert.Equal(3, cable.Pieces);
        Assert.Equal(["length-missing"], cable.Warnings);
    }

    [Fact]
    public async Task Cut_list_requires_session_and_rejects_a_harness_from_another_project()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var first = await CreateHarnessAsync(client, csrf, "CUT-1", 1);
        var second = await CreateHarnessAsync(client, csrf, "CUT-2", 1);

        using var wrongOwner = await client.GetAsync(
            CutListRoute(second.ProjectId, first.HarnessId), TestContext.Current.CancellationToken);
        var error = await wrongOwner.Content.ReadFromJsonAsync<ApiErrorResponse>(
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, wrongOwner.StatusCode);
        Assert.Equal("harness_not_found", Assert.IsType<ApiErrorResponse>(error).Error);

        using var anonymous = factory.CreateLocalClient();
        using var anonymousResponse = await anonymous.GetAsync(
            CutListRoute(first.ProjectId, first.HarnessId), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymousResponse.StatusCode);
    }

    [Fact]
    public async Task Cut_list_rejects_invalid_precision_instead_of_rounding_input_silently()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var ids = await CreateHarnessAsync(client, csrf, quantity: 1);
        using var content = JsonDocument.Parse(
            """
            {"schemaVersion":1,"connectors":[],"wires":[{"id":"W-1","circuit":"","lengthMm":1.0001}],"views":{"e4":{"layers":[]},"drawing":{"layers":[]}}}
            """);
        using (var save = await SendAsync(
                   client, HttpMethod.Put, DesignRoute(ids.ProjectId, ids.HarnessId),
                   new PutHarnessDesignRequest(0, 1, content.RootElement.Clone()), csrf))
        {
            Assert.Equal(HttpStatusCode.OK, save.StatusCode);
        }

        using var response = await client.GetAsync(
            CutListRoute(ids.ProjectId, ids.HarnessId), TestContext.Current.CancellationToken);
        var error = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_cut_list_design", Assert.IsType<ApiErrorResponse>(error).Error);
        Assert.Equal("content.wires[0].lengthMm", error.Field);
    }

    [Theory]
    [InlineData("snapshotId", "00000000-0000-0000-0000-000000000000")]
    [InlineData("snapshotSha256", "not-a-hash")]
    [InlineData("recordId", "not-a-hash")]
    [InlineData("entityType", "terminal")]
    [InlineData("sourceKey", "")]
    [InlineData("displayName", "")]
    public async Task Cut_list_rejects_an_invalid_material_binding(string field, string invalidValue)
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var ids = await CreateHarnessAsync(client, csrf);
        var material = new Dictionary<string, object?>
        {
            ["sourceId"] = "technology-wires",
            ["snapshotId"] = Guid.NewGuid().ToString("D"),
            ["snapshotSha256"] = new string('a', 64),
            ["recordId"] = new string('b', 64),
            ["entityType"] = "wire",
            ["sourceKey"] = "WIRE-1",
            ["displayName"] = "Провод 1",
        };
        material[field] = invalidValue;
        var content = JsonSerializer.SerializeToElement(new
        {
            schemaVersion = 1,
            connectors = Array.Empty<object>(),
            wires = new[] { new { id = "W-1", circuit = "", materialBinding = material, lengthMm = 10m } },
            views = new { e4 = new { layers = Array.Empty<object>() }, drawing = new { layers = Array.Empty<object>() } },
        });
        using (var save = await SendAsync(
                   client, HttpMethod.Put, DesignRoute(ids.ProjectId, ids.HarnessId),
                   new PutHarnessDesignRequest(0, 1, content), csrf))
        {
            Assert.Equal(HttpStatusCode.OK, save.StatusCode);
        }

        using var response = await client.GetAsync(
            CutListRoute(ids.ProjectId, ids.HarnessId), TestContext.Current.CancellationToken);
        var error = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_cut_list_design", Assert.IsType<ApiErrorResponse>(error).Error);
        Assert.Equal($"content.wires[0].materialBinding.{field}", error.Field);
    }

    private static async Task PrepareCutRouteAsync(HttpClient client, string csrf, Guid projectId, Guid harnessId)
    {
        var design = (await client.GetFromJsonAsync<HarnessDesignResponse>(DesignRoute(projectId, harnessId), TestContext.Current.CancellationToken))!;
        var content = PreparedCutRouteFixture.Add(design.Content, design.HarnessQuantity ?? 1, design.SourceFingerprint);
        using var prepared = await SendAsync(client, HttpMethod.Put, DesignRoute(projectId, harnessId), new PutHarnessDesignRequest(design.Revision, 1, content, 2), csrf);
        Assert.True(prepared.IsSuccessStatusCode, await prepared.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
    }

    private static async Task<string> StartSessionAsync(HttpClient client)
    {
        using var page = await client.GetAsync("/", TestContext.Current.CancellationToken);
        page.EnsureSuccessStatusCode();
        var session = await client.GetFromJsonAsync<SessionBootstrapResponse>(
            "/api/v1/session", TestContext.Current.CancellationToken);
        return Assert.IsType<SessionBootstrapResponse>(session).CsrfNonce;
    }

    private static async Task<(Guid ProjectId, Guid HarnessId)> CreateHarnessAsync(
        HttpClient client,
        string csrf,
        string designation = "CUT",
        long quantity = 1)
    {
        using var create = await SendAsync(
            client, HttpMethod.Post, "/api/v1/projects",
            new CreateProjectRequest(designation, "Cut list", null, "draft"), csrf);
        var project = await create.Content.ReadFromJsonAsync<ProjectDetailsResponse>(
            TestContext.Current.CancellationToken);
        using var add = await SendAsync(
            client, HttpMethod.Post, $"/api/v1/projects/{project!.ProjectId:D}/harnesses",
            new AddHarnessRequest(Guid.NewGuid(), 0, "Жгут", quantity), csrf);
        var result = await add.Content.ReadFromJsonAsync<ProjectCommandResponse>(
            TestContext.Current.CancellationToken);
        return (project.ProjectId, Assert.Single(result!.Project.Harnesses).HarnessId);
    }

    private static async Task<HttpResponseMessage> SendAsync(
        HttpClient client,
        HttpMethod method,
        string path,
        object body,
        string csrf)
    {
        using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(body) };
        request.Headers.TryAddWithoutValidation("Origin", Origin);
        request.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, csrf);
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static string DesignRoute(Guid projectId, Guid harnessId) =>
        $"/api/v1/projects/{projectId:D}/harnesses/{harnessId:D}/design";

    private static string CutListRoute(Guid projectId, Guid harnessId) =>
        $"/api/v1/projects/{projectId:D}/harnesses/{harnessId:D}/cut-list";
}
