using Techmap.Domain;
using Xunit;

namespace Techmap.Domain.Tests;

public sealed class CutLengthCalculatorTests
{
    [Fact]
    public void Ex01_wire_keeps_sources_and_each_end_correction_separate()
    {
        var result = Calculate(
            [Millimetres(1_000), Millimetres(10), Millimetres(20)],
            correctionAtFirstEnd: -2,
            correctionAtSecondEnd: 3);

        Assert.True(result.IsComplete);
        Assert.Equal([1_000m, 10m, 20m], result.SourceDimensions.Select(ValueInMillimetres));
        Assert.Equal(-2m, result.FirstEndCorrection.Millimetres);
        Assert.Equal(3m, result.SecondEndCorrection.Millimetres);
        Assert.Equal(1_031m, result.UnroundedTotal!.Value.Millimetres);
        Assert.Equal(1_031m, result.CutLength!.Value.Millimetres);
        Assert.Equal(1_031m, result.MaterialConsumption!.Value.Millimetres);
    }

    [Fact]
    public void Ex01_braid_keeps_covered_section_separate_and_cuts_950_mm()
    {
        var result = Calculate(
            [Millimetres(900), Millimetres(30), Millimetres(20)],
            correctionAtFirstEnd: 0,
            correctionAtSecondEnd: 0);

        Assert.Equal(900m, result.SourceDimensions[0]!.Value.Millimetres);
        Assert.Equal(950m, result.CutLength!.Value.Millimetres);
    }

    [Fact]
    public void Cut_positions_that_differ_by_one_millimetre_remain_distinct()
    {
        var first = Calculate([Millimetres(1_031)], 0, 0);
        var second = Calculate([Millimetres(1_032)], 0, 0);

        Assert.NotEqual(first.CutLength, second.CutLength);
    }

    [Fact]
    public void Default_rounding_is_up_to_one_millimetre_and_only_changes_final_total()
    {
        var result = Calculate(
            [Length.FromMillimetres(10.001m), Length.FromMillimetres(0.001m)],
            correctionAtFirstEnd: 0,
            correctionAtSecondEnd: 0);

        Assert.Equal(10.001m, result.SourceDimensions[0]!.Value.Millimetres);
        Assert.Equal(0.001m, result.SourceDimensions[1]!.Value.Millimetres);
        Assert.Equal(10.002m, result.UnroundedTotal!.Value.Millimetres);
        Assert.Equal(11m, result.CutLength!.Value.Millimetres);
        Assert.Equal(1m, result.RoundingStep.Millimetres);
    }

    [Fact]
    public void Configured_step_is_applied_only_to_final_total()
    {
        var result = CutLengthCalculator.Calculate(new CutLengthInput(
            [Length.FromMillimetres(10.1m), Length.FromMillimetres(10.1m)],
            LengthCorrection.FromMillimetres(-0.1m),
            LengthCorrection.FromMillimetres(0.2m),
            RoundingStep: Millimetres(5)));

        Assert.Equal([10.1m, 10.1m], result.SourceDimensions.Select(ValueInMillimetres));
        Assert.Equal(-0.1m, result.FirstEndCorrection.Millimetres);
        Assert.Equal(0.2m, result.SecondEndCorrection.Millimetres);
        Assert.Equal(20.3m, result.UnroundedTotal!.Value.Millimetres);
        Assert.Equal(25m, result.CutLength!.Value.Millimetres);
    }

    [Fact]
    public void Unknown_source_dimension_produces_no_length_or_consumption()
    {
        var sources = new Length?[] { Millimetres(100), null, new Length(0) };
        var result = Calculate(sources, -2, 3);

        Assert.False(result.IsComplete);
        Assert.Equal(3, result.SourceDimensions.Count);
        Assert.Null(result.SourceDimensions[1]);
        Assert.Equal(0, result.SourceDimensions[2]!.Value.Micrometres);
        Assert.Null(result.UnroundedTotal);
        Assert.Null(result.CutLength);
        Assert.Null(result.MaterialConsumption);
    }

    [Fact]
    public void Calculator_copies_source_dimensions_for_an_immutable_result_snapshot()
    {
        var sources = new Length?[] { Millimetres(10) };
        var result = Calculate(sources, 0, 0);

        sources[0] = Millimetres(99);

        Assert.Equal(10m, result.SourceDimensions[0]!.Value.Millimetres);
        Assert.Throws<NotSupportedException>(() =>
            ((IList<Length?>)result.SourceDimensions)[0] = Millimetres(99));
    }

    [Fact]
    public void Empty_source_is_rejected_instead_of_creating_a_zero_consumption_position()
    {
        Assert.Throws<ArgumentException>(() => Calculate([], 0, 0));
    }

    [Fact]
    public void Negative_total_is_rejected()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            Calculate([Millimetres(1)], -2, 0));
    }

    [Fact]
    public void Physical_zero_is_a_complete_result_and_exact_step_is_not_increased()
    {
        var zero = Calculate([new Length(0)], 0, 0);
        var exact = Calculate([Millimetres(10)], 0, 0);

        Assert.True(zero.IsComplete);
        Assert.Equal(new Length(0), zero.MaterialConsumption);
        Assert.Equal(Millimetres(10), exact.CutLength);
    }

    [Fact]
    public void Overflow_in_sum_or_final_rounding_is_rejected()
    {
        Assert.Throws<OverflowException>(() =>
            CutLengthCalculator.Calculate(new CutLengthInput(
                [new Length(long.MaxValue), new Length(1)],
                new LengthCorrection(0),
                new LengthCorrection(0))));

        Assert.Throws<OverflowException>(() =>
            CutLengthCalculator.Calculate(new CutLengthInput(
                [new Length(long.MaxValue)],
                new LengthCorrection(0),
                new LengthCorrection(0),
                new Length(2))));
    }

    [Fact]
    public void Large_intermediate_sum_is_allowed_when_signed_corrections_make_final_fit()
    {
        var result = CutLengthCalculator.Calculate(new CutLengthInput(
            [new Length(long.MaxValue), new Length(1)],
            new LengthCorrection(-2),
            new LengthCorrection(0),
            new Length(1)));

        Assert.Equal(long.MaxValue - 1, result.CutLength!.Value.Micrometres);
    }

    [Fact]
    public void Zero_rounding_step_is_rejected()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            CutLengthCalculator.Calculate(new CutLengthInput(
                [Millimetres(10)],
                new LengthCorrection(0),
                new LengthCorrection(0),
                new Length(0))));
    }

    private static CutLengthResult Calculate(
        IReadOnlyList<Length?> sourceDimensions,
        decimal correctionAtFirstEnd,
        decimal correctionAtSecondEnd) =>
        CutLengthCalculator.Calculate(new CutLengthInput(
            sourceDimensions,
            LengthCorrection.FromMillimetres(correctionAtFirstEnd),
            LengthCorrection.FromMillimetres(correctionAtSecondEnd)));

    private static Length Millimetres(decimal value) => Length.FromMillimetres(value);

    private static decimal ValueInMillimetres(Length? value) => value!.Value.Millimetres;
}
