using System.Numerics;

namespace Techmap.Domain;

public sealed record CapacityInput(
    long? WorkpieceCount,
    long? AvailableWorkstationCount,
    ExactDuration? SetupTimePerWorkstation,
    ExactDuration? CycleTimePerWorkpiece);

public sealed record WorkstationLoadBand(
    long FirstWorkstationNumber,
    long WorkstationCount,
    long WorkpiecesPerWorkstation,
    ExactDuration? DurationPerWorkstation);

public sealed record CapacityResult(
    IReadOnlyList<WorkstationLoadBand>? LoadBands,
    ExactDuration? BlockDuration,
    ExactDuration? Labour)
{
    public bool HasCompleteDistribution => LoadBands is not null;

    public bool HasCompleteTiming => BlockDuration is not null && Labour is not null;
}

public static class CapacityCalculator
{
    public static CapacityResult Calculate(CapacityInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        ValidateCounts(input.WorkpieceCount, input.AvailableWorkstationCount);

        if (input.WorkpieceCount is null || input.AvailableWorkstationCount is null)
        {
            return new CapacityResult(LoadBands: null, BlockDuration: null, Labour: null);
        }

        var workpieceCount = input.WorkpieceCount.Value;
        var workstationCount = input.AvailableWorkstationCount.Value;

        var baseLoad = workpieceCount / workstationCount;
        var largerBandCount = workpieceCount % workstationCount;
        var smallerBandCount = workstationCount - largerBandCount;
        var timingsComplete =
            input.SetupTimePerWorkstation is not null &&
            input.CycleTimePerWorkpiece is not null;
        var bands = new List<WorkstationLoadBand>(2);
        BigInteger blockMicroseconds = BigInteger.Zero;
        BigInteger labourMicroseconds = BigInteger.Zero;

        if (largerBandCount > 0)
        {
            AddBand(largerBandCount, checked(baseLoad + 1));
        }

        AddBand(smallerBandCount, baseLoad);

        return new CapacityResult(
            Array.AsReadOnly(bands.ToArray()),
            timingsComplete
                ? ToDuration(blockMicroseconds, "The block duration exceeds the supported range.")
                : null,
            timingsComplete
                ? ToDuration(labourMicroseconds, "The block labour exceeds the supported range.")
                : null);

        void AddBand(long count, long load)
        {
            if (count == 0)
            {
                return;
            }

            ExactDuration? duration = null;
            if (timingsComplete)
            {
                var durationMicroseconds = load == 0
                    ? BigInteger.Zero
                    : (BigInteger)input.SetupTimePerWorkstation!.Value.Microseconds +
                        (BigInteger)load * input.CycleTimePerWorkpiece!.Value.Microseconds;
                duration = ToDuration(
                    durationMicroseconds,
                    "A workstation duration exceeds the supported range.");
                blockMicroseconds = BigInteger.Max(blockMicroseconds, durationMicroseconds);
                labourMicroseconds += (BigInteger)count * durationMicroseconds;
            }

            var firstWorkstationNumber = bands.Count == 0
                ? 1
                : checked(bands[^1].FirstWorkstationNumber + bands[^1].WorkstationCount);
            bands.Add(new WorkstationLoadBand(
                firstWorkstationNumber,
                count,
                load,
                duration));
        }
    }

    private static void ValidateCounts(long? workpieceCount, long? workstationCount)
    {
        if (workpieceCount < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(workpieceCount),
                "The workpiece count must not be negative.");
        }

        if (workstationCount <= 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(workstationCount),
                "At least one complete independent workstation is required.");
        }
    }

    private static ExactDuration ToDuration(BigInteger microseconds, string overflowMessage)
    {
        if (microseconds > long.MaxValue)
        {
            throw new OverflowException(overflowMessage);
        }

        return new ExactDuration((long)microseconds);
    }
}
