// Injected script to access YouTube's player data and intercept subtitle fetches
(function() {
    console.log('[Dual Subtitle Inject] Script loaded');
    
    let lastVideoId = null;
    let attempts = 0;

    // INTERCEPT FETCH API - This is how YouTube loads subtitles!
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        const url = args[0];
        
        // Intercept timedtext API calls
        if (typeof url === 'string' && url.includes('/api/timedtext')) {
            console.log('[Dual Subtitle Inject] 🎯 Intercepting subtitle fetch:', url);
            
            return originalFetch.apply(this, args).then(response => {
                // Clone response so we can read it without consuming it
                const clonedResponse = response.clone();
                
                clonedResponse.text().then(text => {
                    console.log(`[Dual Subtitle Inject] ✅ Intercepted ${text.length} bytes from timedtext`);
                    
                    // Extract language from URL
                    const langMatch = url.match(/[&?]lang=([^&]+)/);
                    const lang = langMatch ? langMatch[1] : 'unknown';
                    
                    // Send to content script
                    window.postMessage({
                        type: 'YT_SUBTITLE_DATA',
                        lang: lang,
                        data: text,
                        url: url
                    }, '*');
                    
                    console.log(`[Dual Subtitle Inject] 📤 Sent ${lang} subtitles to content script`);
                }).catch(err => {
                    console.error('[Dual Subtitle Inject] Error reading intercepted response:', err);
                });
                
                return response; // Return original response to YouTube
            });
        }
        
        return originalFetch.apply(this, args);
    };

    // INTERCEPT XMLHttpRequest - Backup method
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._url = url;
        return originalXHROpen.apply(this, [method, url, ...rest]);
    };
    
    XMLHttpRequest.prototype.send = function(...args) {
        if (this._url && this._url.includes('/api/timedtext')) {
            console.log('[Dual Subtitle Inject] 🎯 Intercepting XHR subtitle request:', this._url);
            
            this.addEventListener('load', function() {
                if (this.responseText) {
                    console.log(`[Dual Subtitle Inject] ✅ Intercepted ${this.responseText.length} bytes from XHR`);
                    
                    const langMatch = this._url.match(/[&?]lang=([^&]+)/);
                    const lang = langMatch ? langMatch[1] : 'unknown';
                    
                    window.postMessage({
                        type: 'YT_SUBTITLE_DATA',
                        lang: lang,
                        data: this.responseText,
                        url: this._url
                    }, '*');
                    
                    console.log(`[Dual Subtitle Inject] 📤 Sent ${lang} subtitles from XHR`);
                }
            });
        }
        
        return originalXHRSend.apply(this, args);
    };

    function sendPlayerData() {
        if (window.ytInitialPlayerResponse) {
            const videoId = window.ytInitialPlayerResponse.videoDetails?.videoId;
            const hasCaptions = !!window.ytInitialPlayerResponse.captions;
            
            console.log('[Dual Subtitle Inject] Found player data:', {videoId: videoId,
                                                                       hasCaptions: hasCaptions});
            
            // Only send if we have a video ID and it's different from last time
            if (videoId && videoId !== lastVideoId) {
                lastVideoId = videoId;
                window.postMessage({type: 'YT_PLAYER_DATA',
                                   data: window.ytInitialPlayerResponse}, '*');
                console.log('[Dual Subtitle Inject] ✓ Sent player data for video:', videoId);
                return true;
            }
        }
        return false;
    }

    // Initial check
    const checkInterval = setInterval(() => {
        attempts++;
        console.log(`[Dual Subtitle Inject] Checking for player data... (attempt ${attempts})`);
        
        if (sendPlayerData()) {
            clearInterval(checkInterval);
            console.log('[Dual Subtitle Inject] Player data sent, stopping checks');
        }
        
        if (attempts > 50) { // 5 seconds max
            clearInterval(checkInterval);
            console.error('[Dual Subtitle Inject] Timeout waiting for player data');
        }
    }, 100);

    // Watch for navigation changes (YouTube is a SPA)
    let lastUrl = location.href;
    const urlCheckInterval = setInterval(() => {
        if (location.href !== lastUrl) {
            console.log('[Dual Subtitle Inject] URL changed:', lastUrl, '→', location.href);
            lastUrl = location.href;
            // Reset video ID so next check will send data
            lastVideoId = null;
            attempts = 0;
            // Wait a bit for player data to update
            setTimeout(sendPlayerData, 500);
        }
    }, 500);
    
    console.log('[Dual Subtitle Inject] 🔧 Fetch/XHR interception active');
})();
