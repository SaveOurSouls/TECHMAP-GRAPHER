using Techmap.Domain;
using Xunit;

namespace Techmap.Domain.Tests;

public sealed class CapacityCalculatorTests
{
    [Fact]
    public void Ex03_distributes_eleven_workpieces_as_six_and_five()
    {
        var result = CapacityCalculator.Calculate(new CapacityInput(
            WorkpieceCount: 11,
            AvailableWorkstationCount: 2,
            SetupTimePerWorkstation: Seconds(120),
            CycleTimePerWorkpiece: Seconds(60)));

        Assert.True(result.HasCompleteDistribution);
        Assert.True(result.HasCompleteTiming);
        Assert.Equal(2, result.LoadBands!.Count);
        AssertBand(result.LoadBands[0], first: 1, workstationCount: 1, load: 6, seconds: 480);
        AssertBand(result.LoadBands[1], first: 2, workstationCount: 1, load: 5, seconds: 420);
        Assert.Equal(480m, result.BlockDuration!.Value.Seconds);
        Assert.Equal(900m, result.Labour!.Value.Seconds);
    }

    [Fact]
    public void Distribution_is_stable_and_loads_differ_by_at_most_one()
    {
        var result = CapacityCalculator.Calculate(new CapacityInput(14, 4, Seconds(0), Seconds(1)));

        Assert.Equal(2, result.LoadBands!.Count);
        AssertBand(result.LoadBands[0], first: 1, workstationCount: 2, load: 4, seconds: 4);
        AssertBand(result.LoadBands[1], first: 3, workstationCount: 2, load: 3, seconds: 3);
        Assert.Equal(
            1,
            result.LoadBands[0].WorkpiecesPerWorkstation -
                result.LoadBands[1].WorkpiecesPerWorkstation);
    }

    [Fact]
    public void One_workstation_processes_the_whole_batch()
    {
        var result = CapacityCalculator.Calculate(new CapacityInput(3, 1, Seconds(5), Seconds(10)));

        var band = Assert.Single(result.LoadBands!);
        AssertBand(band, first: 1, workstationCount: 1, load: 3, seconds: 35);
        Assert.Equal(35m, result.BlockDuration!.Value.Seconds);
        Assert.Equal(35m, result.Labour!.Value.Seconds);
    }

    [Fact]
    public void Empty_workstations_form_a_zero_duration_band_without_setup()
    {
        var result = CapacityCalculator.Calculate(new CapacityInput(2, 4, Seconds(10), Seconds(5)));

        Assert.Equal(2, result.LoadBands!.Count);
        AssertBand(result.LoadBands[0], first: 1, workstationCount: 2, load: 1, seconds: 15);
        AssertBand(result.LoadBands[1], first: 3, workstationCount: 2, load: 0, seconds: 0);
        Assert.Equal(15m, result.BlockDuration!.Value.Seconds);
        Assert.Equal(30m, result.Labour!.Value.Seconds);
    }

    [Fact]
    public void Empty_batch_is_known_zero_when_times_and_a_workstation_are_known()
    {
        var result = CapacityCalculator.Calculate(new CapacityInput(0, 3, Seconds(120), Seconds(60)));

        var band = Assert.Single(result.LoadBands!);
        AssertBand(band, first: 1, workstationCount: 3, load: 0, seconds: 0);
        Assert.Equal(0, result.BlockDuration!.Value.Microseconds);
        Assert.Equal(0, result.Labour!.Value.Microseconds);
    }

    [Fact]
    public void Missing_counts_and_missing_times_are_distinct_from_zero()
    {
        var missingCount = CapacityCalculator.Calculate(
            new CapacityInput(null, 2, Seconds(0), Seconds(0)));
        var missingTime = CapacityCalculator.Calculate(
            new CapacityInput(2, 2, null, Seconds(0)));

        Assert.Null(missingCount.LoadBands);
        Assert.Null(missingCount.BlockDuration);
        Assert.Null(missingCount.Labour);
        Assert.False(missingCount.HasCompleteDistribution);

        var band = Assert.Single(missingTime.LoadBands!);
        Assert.Equal(2, band.WorkstationCount);
        Assert.Equal(1, band.WorkpiecesPerWorkstation);
        Assert.Null(band.DurationPerWorkstation);
        Assert.Null(missingTime.BlockDuration);
        Assert.Null(missingTime.Labour);
        Assert.True(missingTime.HasCompleteDistribution);
        Assert.False(missingTime.HasCompleteTiming);
    }

    [Fact]
    public void Positive_batch_with_no_complete_workstation_is_rejected()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => CapacityCalculator.Calculate(
            new CapacityInput(1, 0, Seconds(0), Seconds(0))));
        Assert.Throws<ArgumentOutOfRangeException>(() => CapacityCalculator.Calculate(
            new CapacityInput(0, 0, Seconds(0), Seconds(0))));
        Assert.Throws<ArgumentOutOfRangeException>(() => CapacityCalculator.Calculate(
            new CapacityInput(-1, 1, Seconds(0), Seconds(0))));
        Assert.Throws<ArgumentOutOfRangeException>(() => CapacityCalculator.Calculate(
            new CapacityInput(1, -1, Seconds(0), Seconds(0))));
    }

    [Fact]
    public void Compact_bands_support_long_boundary_counts()
    {
        var result = CapacityCalculator.Calculate(new CapacityInput(
            long.MaxValue,
            long.MaxValue,
            new ExactDuration(0),
            new ExactDuration(0)));

        var band = Assert.Single(result.LoadBands!);
        Assert.Equal(1, band.FirstWorkstationNumber);
        Assert.Equal(long.MaxValue, band.WorkstationCount);
        Assert.Equal(1, band.WorkpiecesPerWorkstation);
        Assert.Equal(0, result.BlockDuration!.Value.Microseconds);
        Assert.Equal(0, result.Labour!.Value.Microseconds);
    }

    [Fact]
    public void Long_maximum_batch_on_one_workstation_does_not_overflow_distribution()
    {
        var result = CapacityCalculator.Calculate(new CapacityInput(
            long.MaxValue,
            1,
            new ExactDuration(0),
            new ExactDuration(0)));

        var band = Assert.Single(result.LoadBands!);
        Assert.Equal(long.MaxValue, band.WorkpiecesPerWorkstation);
        Assert.Equal(0, result.BlockDuration!.Value.Microseconds);
        Assert.Equal(0, result.Labour!.Value.Microseconds);
    }

    [Fact]
    public void Workstation_and_labour_overflow_are_rejected()
    {
        Assert.Throws<OverflowException>(() => CapacityCalculator.Calculate(
            new CapacityInput(1, 1, new ExactDuration(long.MaxValue), new ExactDuration(1))));
        Assert.Throws<OverflowException>(() => CapacityCalculator.Calculate(
            new CapacityInput(2, 2, new ExactDuration(long.MaxValue / 2 + 1), new ExactDuration(0))));
    }

    private static void AssertBand(
        WorkstationLoadBand band,
        long first,
        long workstationCount,
        long load,
        decimal seconds)
    {
        Assert.Equal(first, band.FirstWorkstationNumber);
        Assert.Equal(workstationCount, band.WorkstationCount);
        Assert.Equal(load, band.WorkpiecesPerWorkstation);
        Assert.Equal(seconds, band.DurationPerWorkstation!.Value.Seconds);
    }

    private static ExactDuration Seconds(decimal value) => ExactDuration.FromSeconds(value);
}
