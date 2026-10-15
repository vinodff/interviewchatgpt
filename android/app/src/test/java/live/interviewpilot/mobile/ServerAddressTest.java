package live.interviewpilot.mobile;

import static org.junit.Assert.*;
import org.junit.Test;

public class ServerAddressTest {
    @Test public void acceptsHttpsAndNormalizes() {
        assertEquals("https://example.com/", ServerAddress.normalize(" HTTPS://EXAMPLE.COM ", false));
        assertEquals("https://example.com:8443/", ServerAddress.normalize("https://example.com:8443/", false));
    }
    @Test public void debugLoopbackOnly() {
        assertEquals("http://localhost:3001/", ServerAddress.normalize("http://localhost:3001", true));
        assertEquals("http://127.0.0.1:3001/", ServerAddress.normalize("http://127.0.0.1:3001", true));
        for (String bad : new String[] {"http://localhost:3001", "http://127.0.0.1", "http://example.com"}) {
            assertThrows(IllegalArgumentException.class, () -> ServerAddress.normalize(bad, false));
        }
    }
    @Test public void rejectsUnsafeAndAmbiguousAddresses() {
        for (String bad : new String[] {"javascript:alert(1)", "file:///sdcard/file", "http://192.168.1.1:3001", "https://example.com/login", "https://me:pass@example.com", "https://example.com?next=evil", "https://example.com/#fragment", "https://example.com:0", "https://example.com:65536", "", "https://example.com\\@evil.com"}) {
            assertThrows(bad, IllegalArgumentException.class, () -> ServerAddress.normalize(bad, true));
        }
    }
    @Test public void originChecksSchemeHostAndPort() {
        assertTrue(ServerAddress.sameOrigin("https://example.com/", "https://example.com:443/api"));
        for (String bad : new String[] {"http://example.com", "https://example.com:8443", "https://example.com.evil.com/", "https://user@example.com/", "https://evil.com/?example.com", "file:///data", "not a URL"}) {
            assertFalse(bad, ServerAddress.sameOrigin("https://example.com/", bad));
        }
    }
}
