// Native-camera barcode capture.
// Live video scanning fails on most phones because getUserMedia cannot
// trigger macro autofocus. Instead we open the phone's real camera app
// via <input capture>, then decode the resulting still image — which is
// sharp because the native camera focused properly.
(function () {
    const trigger = document.getElementById('scan-trigger');
    const fileInput = document.getElementById('scan-file');
    const status = document.getElementById('scan-status');
    const searchInput = document.querySelector('input[name="query"]');
    const form = searchInput && searchInput.closest('form');

    if (!trigger || !fileInput || !form) return;

    const idleLabel = trigger.innerHTML;

    function setStatus(msg, tone) {
        if (!status) return;
        status.textContent = msg;
        status.className = 'text-center text-sm mt-3 ' +
            (tone === 'error' ? 'text-red-500'
                : tone === 'ok' ? 'text-green-500'
                : 'opacity-50');
    }

    trigger.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;

        trigger.disabled = true;
        trigger.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Reading...</span>';
        setStatus('Decoding barcode...', 'idle');

        const decoder = new Html5Qrcode('scan-decoder', {
            formatsToSupport: [
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.EAN_8,
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E
            ]
        });

        try {
            const result = await decoder.scanFileV2(file, false);
            const code = result.decodedText;
            setStatus('Found: ' + code, 'ok');
            searchInput.value = code;
            form.submit();
        } catch (err) {
            setStatus('No barcode detected. Try again — fill the frame with the barcode and hold steady.', 'error');
            trigger.disabled = false;
            trigger.innerHTML = idleLabel;
        } finally {
            try { await decoder.clear(); } catch (e) {}
            fileInput.value = '';
        }
    });
})();
