using System.Net;
using System.Net.Sockets;

namespace Techmap.Infrastructure.GoogleSheets;

public static class GoogleSheetsNetworkPolicy
{
    public static bool IsPublicAddress(IPAddress address)
    {
        ArgumentNullException.ThrowIfNull(address);
        if (address.IsIPv4MappedToIPv6)
            address = address.MapToIPv4();

        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            var bytes = address.GetAddressBytes();
            return bytes[0] switch
            {
                0 or 10 or 127 => false,
                100 when bytes[1] is >= 64 and <= 127 => false,
                168 when bytes[1] == 63 && bytes[2] == 129 && bytes[3] == 16 => false,
                169 when bytes[1] == 254 => false,
                172 when bytes[1] is >= 16 and <= 31 => false,
                192 when bytes[1] == 0 => false,
                192 when bytes[1] == 31 && bytes[2] == 196 => false,
                192 when bytes[1] == 52 && bytes[2] == 193 => false,
                192 when bytes[1] == 88 && bytes[2] == 99 => false,
                192 when bytes[1] == 168 => false,
                192 when bytes[1] == 175 && bytes[2] == 48 => false,
                198 when bytes[1] is 18 or 19 => false,
                198 when bytes[1] == 51 && bytes[2] == 100 => false,
                203 when bytes[1] == 0 && bytes[2] == 113 => false,
                >= 224 => false,
                _ => true,
            };
        }

        if (address.AddressFamily != AddressFamily.InterNetworkV6 ||
            address.Equals(IPAddress.IPv6None) ||
            address.Equals(IPAddress.IPv6Loopback) ||
            address.IsIPv6LinkLocal ||
            address.IsIPv6Multicast ||
            address.IsIPv6SiteLocal)
            return false;

        var ipv6 = address.GetAddressBytes();
        if ((ipv6[0] & 0xe0) != 0x20) // Only global-unicast 2000::/3.
            return false;
        var first = ReadUInt16(ipv6, 0);
        var second = ReadUInt16(ipv6, 2);
        if (first == 0x2001 &&
            (second <= 0x01ff || second == 0x0db8))
            return false;
        if (first == 0x2002 || first == 0x3fff && second <= 0x0fff)
            return false;
        return true;
    }

    private static ushort ReadUInt16(byte[] bytes, int offset) =>
        (ushort)((bytes[offset] << 8) | bytes[offset + 1]);

    public static async ValueTask<Stream> ConnectPublicAsync(
        SocketsHttpConnectionContext context,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, cancellationToken)
            .ConfigureAwait(false);
        var publicAddresses = addresses
            .Where(IsPublicAddress)
            .OrderBy(address => address.AddressFamily == AddressFamily.InterNetwork ? 0 : 1)
            .ThenBy(address => Convert.ToHexString(address.GetAddressBytes()), StringComparer.Ordinal)
            .ToArray();
        if (publicAddresses.Length == 0)
        {
            throw new GoogleSheetsDownloadException(
                "google_sheets_address_forbidden",
                "Адрес Google Sheets разрешился в локальную или служебную сеть.");
        }

        Exception? lastError = null;
        foreach (var address in publicAddresses)
        {
            var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp)
            {
                NoDelay = true,
            };
            try
            {
                await socket.ConnectAsync(
                    new IPEndPoint(address, context.DnsEndPoint.Port),
                    cancellationToken).ConfigureAwait(false);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch (Exception error) when (error is SocketException or IOException)
            {
                lastError = error;
                socket.Dispose();
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        }

        throw new HttpRequestException(
            "No resolved public Google endpoint accepted the connection.",
            lastError);
    }
}
