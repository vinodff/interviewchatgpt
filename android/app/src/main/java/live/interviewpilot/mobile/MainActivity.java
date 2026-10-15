package live.interviewpilot.mobile;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowInsets;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.Arrays;

/** Android host for the real web application; all AI and data stay on the server. */
public final class MainActivity extends Activity {
    private static final int MICROPHONE_REQUEST = 41;
    private static final int DOCUMENT_REQUEST = 42;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private PermissionRequest pendingMicrophone;
    private ValueCallback<Uri[]> pendingFiles;
    private String server;
    private boolean loaded;
    private boolean foreground;
    private boolean reloadAfterBackground;
    private boolean awaitingRuntimePermission;
    private boolean hostStopped;
    private Runnable timeout;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        server = getPreferences(MODE_PRIVATE).getString("server", BuildConfig.DEBUG ? "http://localhost:3001/" : "");
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::confirmLeave);
        if (server.isEmpty()) showConnection(null);
        else openWorkspace(server);
    }

    private void applyInsets(View view) {
        view.setOnApplyWindowInsetsListener((target, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                target.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                target.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
    }

    private void openWorkspace(String address) {
        try { server = ServerAddress.normalize(address, BuildConfig.DEBUG); }
        catch (IllegalArgumentException error) { showConnection(getString(R.string.url_error)); return; }
        destroyWebView();
        getPreferences(MODE_PRIVATE).edit().putString("server", server).apply();
        webView = new WebView(this);
        // Speech and reading do not reset Android's touch inactivity timer.
        webView.setKeepScreenOn(true);
        webView.setBackgroundColor(Color.rgb(247, 248, 243));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " InterviewPilotAndroid/1.0");
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.setWebViewClient(new WorkspaceClient());
        webView.setWebChromeClient(new WorkspaceChrome());
        applyInsets(webView);
        setContentView(webView);
        loadWorkspace();
    }

    private void loadWorkspace() {
        loaded = false;
        if (timeout != null) handler.removeCallbacks(timeout);
        timeout = () -> { if (!loaded && webView != null) showConnection(getString(R.string.connection_error)); };
        handler.postDelayed(timeout, 20000);
        webView.loadUrl(server);
    }

    private void showConnection(String message) {
        reloadAfterBackground = false;
        destroyWebView();
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(247, 248, 243));
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        int spacing = Math.round(24 * getResources().getDisplayMetrics().density);
        column.setPadding(spacing, spacing * 2, spacing, spacing);
        TextView title = new TextView(this);
        title.setText(R.string.connection_title);
        title.setTextSize(28);
        title.setTextColor(Color.rgb(0, 45, 48));
        column.addView(title);
        addText(column, getString(R.string.connection_help), 16, spacing);
        if (message != null) addText(column, message, 16, spacing);
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint(R.string.server_address);
        input.setContentDescription(getString(R.string.server_address));
        input.setText(server == null || server.isEmpty() ? (BuildConfig.DEBUG ? "http://localhost:3001" : "") : server);
        input.setTextSize(16);
        column.addView(input, new LinearLayout.LayoutParams(-1, -2));
        Button connect = new Button(this);
        connect.setText(R.string.connect);
        connect.setOnClickListener(view -> {
            try {
                String address = ServerAddress.normalize(input.getText().toString(), BuildConfig.DEBUG);
                ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(input.getWindowToken(), 0);
                openWorkspace(address);
            } catch (IllegalArgumentException error) { input.setError(getString(R.string.url_error)); }
        });
        column.addView(connect, new LinearLayout.LayoutParams(-1, -2));
        addText(column, getString(R.string.connection_privacy), 14, spacing);
        scroll.addView(column);
        applyInsets(scroll);
        setContentView(scroll);
    }

    private void addText(LinearLayout parent, String text, int size, int margin) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(size);
        view.setTextColor(Color.rgb(52, 77, 77));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = margin;
        params.bottomMargin = margin;
        parent.addView(view, params);
    }

    private void confirmLeave() {
        new AlertDialog.Builder(this).setTitle(R.string.close_title).setMessage(R.string.close_message)
                .setPositiveButton(R.string.stay, (dialog, which) -> { })
                .setNeutralButton(R.string.connection_settings, (dialog, which) -> showConnection(null))
                .setNegativeButton(R.string.close, (dialog, which) -> finish()).show();
    }

    // API 26–32 require this callback; API 33+ use the dispatcher registered in onCreate.
    @SuppressLint("GestureBackNavigation")
    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() { confirmLeave(); }

    private boolean trustedPage() {
        return webView != null && ServerAddress.sameOrigin(server, webView.getUrl());
    }

    private void denyMicrophone() {
        if (pendingMicrophone != null) { pendingMicrophone.deny(); pendingMicrophone = null; }
    }

    private void signalCaptureStop() {
        if (trustedPage()) webView.evaluateJavascript("window.dispatchEvent(new Event('interviewpilot:app-background'));", null);
    }

    private void destroyWebView() {
        if (timeout != null) handler.removeCallbacks(timeout);
        denyMicrophone();
        if (pendingFiles != null) { pendingFiles.onReceiveValue(null); pendingFiles = null; }
        if (webView != null) {
            webView.setKeepScreenOn(false);
            signalCaptureStop();
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
    }

    @Override protected void onResume() {
        super.onResume();
        foreground = true;
        hostStopped = false;
        if (webView != null) {
            webView.setKeepScreenOn(true);
            webView.onResume();
            if (reloadAfterBackground) { reloadAfterBackground = false; loadWorkspace(); }
        }
    }

    @Override protected void onPause() {
        super.onPause();
        foreground = false;
        if (webView != null) webView.setKeepScreenOn(false);
        // Android's own permission dialog can pause the activity while Start awaits its result.
        if (!awaitingRuntimePermission) {
            signalCaptureStop();
            if (webView != null) webView.onPause();
        }
    }

    @Override protected void onStop() {
        super.onStop();
        hostStopped = true;
        denyMicrophone();
        if (webView != null) {
            signalCaptureStop();
            if (pendingFiles != null || awaitingRuntimePermission) return;
            // Destroying the document stops tracks even if background JavaScript is suspended.
            webView.loadUrl("about:blank");
            reloadAfterBackground = true;
        }
    }

    @Override protected void onDestroy() {
        destroyWebView();
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != MICROPHONE_REQUEST) return;
        awaitingRuntimePermission = false;
        PermissionRequest request = pendingMicrophone;
        pendingMicrophone = null;
        if (request == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED
                && !hostStopped && !isFinishing() && trustedPage() && ServerAddress.sameOrigin(server, request.getOrigin().toString())) {
            request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
        } else {
            request.deny();
            Toast.makeText(this, R.string.microphone_denied, Toast.LENGTH_LONG).show();
        }
    }

    @SuppressWarnings("deprecation")
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != DOCUMENT_REQUEST || pendingFiles == null) return;
        ValueCallback<Uri[]> callback = pendingFiles;
        pendingFiles = null;
        ArrayList<Uri> selected = new ArrayList<>();
        if (result == RESULT_OK && data != null && trustedPage()) {
            ClipData clips = data.getClipData();
            if (clips != null) {
                for (int index = 0; index < Math.min(clips.getItemCount(), 20); index++) selected.add(clips.getItemAt(index).getUri());
            } else if (data.getData() != null) selected.add(data.getData());
        }
        boolean safe = selected.stream().allMatch(uri -> uri != null && "content".equals(uri.getScheme()));
        callback.onReceiveValue(selected.isEmpty() || !safe ? null : selected.toArray(new Uri[0]));
    }

    private final class WorkspaceClient extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (ServerAddress.sameOrigin(server, url)) return false;
            if (request.isForMainFrame() && request.hasGesture() && "https".equals(request.getUrl().getScheme())) {
                new AlertDialog.Builder(MainActivity.this).setTitle(R.string.open_external)
                        .setMessage(request.getUrl().getHost()).setNegativeButton(android.R.string.cancel, null)
                        .setPositiveButton(android.R.string.ok, (dialog, which) -> {
                            try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()).addCategory(Intent.CATEGORY_BROWSABLE)); }
                            catch (ActivityNotFoundException error) { Toast.makeText(MainActivity.this, R.string.browser_unavailable, Toast.LENGTH_LONG).show(); }
                        }).show();
            }
            return true;
        }
        @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
            denyMicrophone();
            if (!"about:blank".equals(url) && !ServerAddress.sameOrigin(server, url)) {
                view.stopLoading(); showConnection(getString(R.string.url_error));
            }
        }
        @Override public void onPageCommitVisible(WebView view, String url) {
            if (ServerAddress.sameOrigin(server, url)) { loaded = true; if (timeout != null) handler.removeCallbacks(timeout); }
        }
        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && ServerAddress.sameOrigin(server, request.getUrl().toString())) showConnection(getString(R.string.connection_error));
        }
        @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse error) {
            if (request.isForMainFrame() && error.getStatusCode() >= 400) showConnection(getString(R.string.connection_error));
        }
    }

    private final class WorkspaceChrome extends WebChromeClient {
        @Override public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                if (!foreground || !trustedPage() || !ServerAddress.sameOrigin(server, request.getOrigin().toString())
                        || !Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                    request.deny(); return;
                }
                denyMicrophone();
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
                } else {
                    pendingMicrophone = request;
                    awaitingRuntimePermission = true;
                    requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, MICROPHONE_REQUEST);
                }
            });
        }
        @Override public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingMicrophone == request) pendingMicrophone = null;
        }
        @SuppressWarnings("deprecation")
        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (!trustedPage() || !foreground) { callback.onReceiveValue(null); return true; }
            if (pendingFiles != null) pendingFiles.onReceiveValue(null);
            pendingFiles = callback;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("*/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
            // Finish the synchronous capture-stop handler before opening another activity.
            view.evaluateJavascript("window.dispatchEvent(new Event('interviewpilot:app-background'));", ignored -> {
                if (pendingFiles != callback || !trustedPage()) return;
                try { startActivityForResult(intent, DOCUMENT_REQUEST); }
                catch (ActivityNotFoundException error) {
                    callback.onReceiveValue(null); pendingFiles = null;
                    Toast.makeText(MainActivity.this, R.string.file_picker_unavailable, Toast.LENGTH_LONG).show();
                }
            });
            return true;
        }
    }
}
