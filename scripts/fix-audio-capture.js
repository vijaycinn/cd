/**
 * Audio Capture Diagnostic and Fix Script
 * 
 * This script helps diagnose and fix audio capture issues for both
 * microphone and system audio (speaker).
 * 
 * Run this in the browser console (DevTools) when the app is running.
 */

(function audioCaptureDiagnostic() {
    console.log('=== Audio Capture Diagnostic ===\n');

    // 1. Check platform
    const platform = process.platform;
    const isWindows = platform === 'win32';
    const isMacOS = platform === 'darwin';
    const isLinux = platform === 'linux';
    
    console.log('Platform:', {
        detected: platform,
        isWindows,
        isMacOS,
        isLinux
    });

    // 2. Check current audio mode
    const currentAudioMode = localStorage.getItem('audioMode');
    console.log('\nCurrent Audio Mode:', currentAudioMode || 'NOT SET (defaults to speaker_only)');
    console.log('Valid modes: speaker_only, mic_only, both');

    // 3. Check if capture is active
    const hasCaptureSession = window.mediaStream !== null;
    console.log('\nCapture Session Active:', hasCaptureSession);

    if (hasCaptureSession && window.mediaStream) {
        const videoTracks = window.mediaStream.getVideoTracks();
        const audioTracks = window.mediaStream.getAudioTracks();
        
        console.log('Video Tracks:', videoTracks.length);
        videoTracks.forEach((track, i) => {
            console.log(`  [${i}] ${track.label} - ${track.readyState}`);
        });

        console.log('Audio Tracks:', audioTracks.length);
        audioTracks.forEach((track, i) => {
            console.log(`  [${i}] ${track.label} - ${track.readyState}`);
        });
    }

    // 4. Check browser permissions
    console.log('\nChecking Browser Permissions...');
    
    if (navigator.permissions) {
        Promise.all([
            navigator.permissions.query({ name: 'microphone' }).catch(err => null),
            navigator.permissions.query({ name: 'camera' }).catch(err => null)
        ]).then(results => {
            if (results[0]) console.log('Microphone Permission:', results[0].state);
            if (results[1]) console.log('Display/Camera Permission:', results[1].state);
        });
    } else {
        console.log('Permissions API not available');
    }

    // 5. Check audio processing state
    console.log('\nAudio Processing State:');
    console.log('audioContext:', window.audioContext ? 'EXISTS' : 'NOT INITIALIZED');
    console.log('audioProcessor:', window.audioProcessor ? 'EXISTS' : 'NOT INITIALIZED');
    console.log('micAudioProcessor:', window.micAudioProcessor ? 'EXISTS' : 'NOT INITIALIZED');

    if (window.audioContext) {
        console.log('audioContext.state:', window.audioContext.state);
        console.log('audioContext.sampleRate:', window.audioContext.sampleRate);
    }

    // 6. Provide fixes
    console.log('\n=== FIXES ===\n');

    console.log('To enable BOTH microphone and speaker capture:');
    console.log('1. Run: localStorage.setItem("audioMode", "both")');
    console.log('2. Stop and restart capture\n');

    console.log('To enable ONLY microphone:');
    console.log('   localStorage.setItem("audioMode", "mic_only")\n');

    console.log('To enable ONLY speaker (system audio):');
    console.log('   localStorage.setItem("audioMode", "speaker_only")\n');

    console.log('To test microphone access:');
    console.log('   navigator.mediaDevices.getUserMedia({ audio: true })');
    console.log('     .then(stream => console.log("✓ Mic works:", stream))');
    console.log('     .catch(err => console.error("✗ Mic failed:", err))\n');

    console.log('To test display/speaker access:');
    console.log('   navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })');
    console.log('     .then(stream => console.log("✓ Display works:", stream))');
    console.log('     .catch(err => console.error("✗ Display failed:", err))\n');

    // 7. Auto-fix: Set to "both" mode
    console.log('=== AUTO-FIX ===\n');
    const shouldAutoFix = confirm(
        'Set audio mode to capture BOTH microphone and speaker?\n\n' +
        'Click OK to enable both, Cancel to skip.'
    );

    if (shouldAutoFix) {
        localStorage.setItem('audioMode', 'both');
        console.log('✓ Audio mode set to "both"');
        console.log('✓ Please STOP and RESTART capture for changes to take effect');
        alert('Audio mode set to capture BOTH microphone and speaker.\n\nPlease STOP and RESTART capture.');
    } else {
        console.log('Auto-fix skipped. Use the commands above to configure manually.');
    }

    console.log('\n=== End Diagnostic ===');
})();
