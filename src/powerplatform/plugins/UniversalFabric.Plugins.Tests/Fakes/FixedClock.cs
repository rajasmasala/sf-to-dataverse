using System;

namespace UniversalFabric.Plugins.Tests.Fakes;

/// <summary>
///     Test-only clock returning a fixed UTC instant so assertions on the
///     stamped values are deterministic.
/// </summary>
internal sealed class FixedClock : ISystemClock
{
    private readonly DateTime _utcNow;

    public FixedClock(DateTime utcNow)
    {
        if (utcNow.Kind != DateTimeKind.Utc)
        {
            throw new ArgumentException("FixedClock requires a UTC DateTime.", nameof(utcNow));
        }
        _utcNow = utcNow;
    }

    public DateTime UtcNow => _utcNow;
}
