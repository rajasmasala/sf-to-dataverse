using System;
using System.Globalization;
using Microsoft.Xrm.Sdk;
using UniversalFabric.Plugins.Tests.Fakes;
using Xunit;

namespace UniversalFabric.Plugins.Tests;

public class AccountUpdateStampPluginTests
{
    private static readonly DateTime FixedUtcNow =
        new(2026, 6, 22, 1, 30, 45, DateTimeKind.Utc);

    private static Entity AccountWith(params (string key, object value)[] attrs)
    {
        var e = new Entity("account");
        e.Id = Guid.NewGuid();
        foreach (var (key, value) in attrs)
        {
            e[key] = value;
        }
        return e;
    }

    [Fact]
    public void Execute_StampsBothFields_WhenSalesforceIdChanges()
    {
        var target = AccountWith(
            ("crfe6_salesforceid", "001000000000001AAA"),
            ("name", "Acme Synced"));
        var (_, provider) = PluginTestHarness.Build(target);

        new AccountUpdateStampPlugin(new FixedClock(FixedUtcNow)).Execute(provider);

        Assert.Equal(FixedUtcNow, target.GetAttributeValue<DateTime>("crfe6_lastmodifiedbyintegration_at"));
        Assert.Equal("Updated via Plugin at 2026-06-22T01:30:45Z",
            target.GetAttributeValue<string>("crfe6_sync_notes"));
    }

    [Fact]
    public void Execute_StampsBothFields_WhenUenChanges()
    {
        var target = AccountWith(("crfe6_uen", "202612345G"));
        var (_, provider) = PluginTestHarness.Build(target);

        new AccountUpdateStampPlugin(new FixedClock(FixedUtcNow)).Execute(provider);

        Assert.Equal(FixedUtcNow, target.GetAttributeValue<DateTime>("crfe6_lastmodifiedbyintegration_at"));
        Assert.Contains("Updated via Plugin at",
            target.GetAttributeValue<string>("crfe6_sync_notes") ?? string.Empty);
    }

    [Fact]
    public void Execute_DoesNotStamp_WhenNeitherTriggerAttributeChanged()
    {
        var target = AccountWith(("description", "Ops note update"));
        var (_, provider) = PluginTestHarness.Build(target);

        new AccountUpdateStampPlugin(new FixedClock(FixedUtcNow)).Execute(provider);

        Assert.False(target.Attributes.Contains("crfe6_lastmodifiedbyintegration_at"));
        Assert.False(target.Attributes.Contains("crfe6_sync_notes"));
    }

    [Fact]
    public void Execute_DoesNotStamp_WhenTargetMissing()
    {
        // Defensive: a misregistered plugin could be invoked without a Target.
        var provider = PluginTestHarness.BuildWithoutTarget();

        new AccountUpdateStampPlugin(new FixedClock(FixedUtcNow)).Execute(provider);
        // Nothing to assert beyond "did not throw" — the absence of a Target
        // should be tolerated silently.
    }

    [Fact]
    public void Execute_StampsBothFields_WhenBothTriggerAttributesChange()
    {
        var target = AccountWith(
            ("crfe6_salesforceid", "001000000000002AAA"),
            ("crfe6_uen", "202699998W"));
        var (_, provider) = PluginTestHarness.Build(target);

        new AccountUpdateStampPlugin(new FixedClock(FixedUtcNow)).Execute(provider);

        Assert.Equal(FixedUtcNow, target.GetAttributeValue<DateTime>("crfe6_lastmodifiedbyintegration_at"));
    }

    [Fact]
    public void Execute_FormatsNoteAsIso8601Zulu_AndRoundTrips()
    {
        var target = AccountWith(("crfe6_uen", "202699999X"));
        var (_, provider) = PluginTestHarness.Build(target);

        new AccountUpdateStampPlugin(new FixedClock(FixedUtcNow)).Execute(provider);

        var note = target.GetAttributeValue<string>("crfe6_sync_notes");
        const string prefix = "Updated via Plugin at ";
        Assert.StartsWith(prefix, note);

        var suffix = note!.Substring(prefix.Length);
        var parsed = DateTime.Parse(suffix, null, DateTimeStyles.RoundtripKind);
        Assert.Equal(DateTimeKind.Utc, parsed.Kind);
        Assert.Equal(FixedUtcNow, parsed);
    }

    [Theory]
    [InlineData(10)] // PreValidation
    [InlineData(30)] // MainOperation
    [InlineData(40)] // PostOperation
    public void Execute_ThrowsWhenRegisteredOnWrongStage(int wrongStage)
    {
        var target = AccountWith(("crfe6_uen", "202600000Y"));
        var (_, provider) = PluginTestHarness.Build(target, stage: wrongStage);

        var ex = Assert.Throws<InvalidPluginExecutionException>(
            () => new AccountUpdateStampPlugin(new FixedClock(FixedUtcNow)).Execute(provider));
        Assert.Contains("PreOperation", ex.Message);
        Assert.Contains(wrongStage.ToString(CultureInfo.InvariantCulture), ex.Message);
    }

    [Fact]
    public void Execute_ThrowsWhenServiceProviderIsNull()
    {
        var plugin = new AccountUpdateStampPlugin(new FixedClock(FixedUtcNow));
        Assert.Throws<ArgumentNullException>(() => plugin.Execute(null!));
    }

    [Fact]
    public void TriggerAttributes_AreExactlySalesforceIdAndUen()
    {
        // Guards against accidentally widening the filter; the plugin registration
        // README documents these two attributes as FilteringAttributes.
        Assert.Equal(
            new[] { "crfe6_salesforceid", "crfe6_uen" },
            AccountUpdateStampPlugin.TriggerAttributes);
    }

    [Fact]
    public void Execute_OverwritesPriorStamp_WhenFiredAgain()
    {
        // Plugin fires once per qualifying update; if it fires twice in the same
        // transaction (replay, parent pipeline), the second stamp must win.
        var target = AccountWith(("crfe6_uen", "202600001A"));
        var firstTime = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var (_, provider) = PluginTestHarness.Build(target);

        new AccountUpdateStampPlugin(new FixedClock(firstTime)).Execute(provider);
        new AccountUpdateStampPlugin(new FixedClock(FixedUtcNow)).Execute(provider);

        Assert.Equal(FixedUtcNow, target.GetAttributeValue<DateTime>("crfe6_lastmodifiedbyintegration_at"));
        Assert.EndsWith("2026-06-22T01:30:45Z", target.GetAttributeValue<string>("crfe6_sync_notes"));
    }
}
