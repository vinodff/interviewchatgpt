package live.interviewpilot.mobile;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Validates the one origin trusted for navigation, uploads, and microphone access. */
final class ServerAddress {
    private ServerAddress() { }

    static String normalize(String value, boolean allowLoopback) {
        try {
            URI uri = new URI(value.trim());
            String host = uri.getHost();
            String scheme = uri.getScheme();
            boolean local = "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host);
            if (host == null || scheme == null || uri.getRawUserInfo() != null
                    || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || !(uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath()))
                    || uri.getPort() == 0 || uri.getPort() > 65535
                    || !("https".equalsIgnoreCase(scheme)
                    || (allowLoopback && local && "http".equalsIgnoreCase(scheme)))) {
                throw new IllegalArgumentException("Invalid workspace address");
            }
            return new URI(scheme.toLowerCase(Locale.ROOT), null, host.toLowerCase(Locale.ROOT),
                    uri.getPort(), "/", null, null).toASCIIString();
        } catch (URISyntaxException | NullPointerException error) {
            throw new IllegalArgumentException("Invalid workspace address", error);
        }
    }

    static boolean sameOrigin(String trusted, String candidate) {
        try {
            URI left = new URI(trusted);
            URI right = new URI(candidate);
            return left.getHost() != null && right.getHost() != null
                    && left.getScheme().equalsIgnoreCase(right.getScheme())
                    && left.getHost().equalsIgnoreCase(right.getHost())
                    && port(left) == port(right) && right.getRawUserInfo() == null;
        } catch (URISyntaxException | NullPointerException error) {
            return false;
        }
    }

    private static int port(URI uri) {
        return uri.getPort() >= 0 ? uri.getPort() : "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }
}
