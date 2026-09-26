using System.Text.Json;
using Techmap.Application;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class CoveringManufacturingLengthTests
{
    [Theory]
    [InlineData("[{\"segmentId\":\"s\",\"from\":0,\"to\":2,\"lengthMm\":100.125}]", 100.125)]
    [InlineData("[{\"segmentId\":\"s\",\"from\":0,\"to\":1,\"lengthMm\":40.125},{\"segmentId\":\"s\",\"from\":1,\"to\":2,\"lengthMm\":60.001}]", 100.126)]
    public void Uses_whole_or_contiguous_dimensions_in_millimetres(string dimensions, decimal expected)
    {
        using var root=JsonDocument.Parse("{\"drawingDocuments\":{\"dimensions\":"+dimensions+"}}");
        using var covering=JsonDocument.Parse("""{"lengthMode":"auto","lengthMm":null,"spans":[{"segmentId":"s","from":0,"to":1,"fromAnchor":0,"toAnchor":2}]}""");
        Assert.Equal(expected,CoveringManufacturingLength.Measure(root.RootElement,covering.RootElement));
    }
    [Theory]
    [InlineData("{\"segmentId\":\"s\",\"from\":0,\"to\":1}")]
    [InlineData("{\"segmentId\":\"s\",\"from\":0,\"to\":1,\"fromAnchor\":0,\"toAnchor\":2}")]
    public void Missing_anchors_or_gaps_remain_unknown_and_do_not_use_pixels(string span)
    {
        using var root=JsonDocument.Parse("""{"drawingDocuments":{"dimensions":[{"segmentId":"s","from":0,"to":1,"lengthMm":50} ]}}""");
        using var covering=JsonDocument.Parse("{\"lengthMode\":\"auto\",\"lengthMm\":9999,\"spans\":["+span+"]}");
        Assert.Null(CoveringManufacturingLength.Measure(root.RootElement,covering.RootElement));
    }
}
