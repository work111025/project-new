// file: public/script.js
document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const loginOverlay = document.getElementById('login-overlay');
    const accessKeyInput = document.getElementById('accessKeyInput');
    const mainContainer = document.querySelector('.container');
    const uploadLabel = document.getElementById('uploadLabel');
    const imagePreview = document.getElementById('imagePreview');
    const loader = document.getElementById('loader');
    const resultText = document.getElementById('resultText');

    // --- Authentication Logic ---
    const showApp = () => {
        loginOverlay.style.display = 'none';
        mainContainer.style.display = 'block';
    };

    const handleKeyValidation = async (key) => {
        try {
            const response = await fetch('/api/validate-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key }),
            });

            if (response.ok) {
                sessionStorage.setItem('accessKey', key); // Store key for the session
                showApp();
            } else {
                const data = await response.json();
                alert(data.error || 'Invalid key');
                accessKeyInput.value = ''; // Clear input on failure
            }
        } catch (error) {
            console.error('Validation request failed:', error);
            alert('Could not connect to the server.');
            accessKeyInput.value = '';
        }
    };

    accessKeyInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            handleKeyValidation(accessKeyInput.value.trim());
        }
    });

    // On page load, check if a key is already in session storage
    const existingKey = sessionStorage.getItem('accessKey');
    if (existingKey) {
        handleKeyValidation(existingKey);
    }


    // --- Main App Logic (No changes needed, already supports streaming) ---
    const processImage = async (imageData) => {
        const accessKey = sessionStorage.getItem('accessKey');
        if (!imageData || !accessKey) return;

        loader.classList.remove('hidden');
        resultText.textContent = ''; // Clear previous results
        resultText.classList.add('hidden');

        try {
            const payload = { ...imageData, key: accessKey };

            const response = await fetch('/api/process-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorData = await response.json();
                if (response.status === 401) {
                    sessionStorage.removeItem('accessKey');
                    window.location.reload();
                }
                throw new Error(errorData.error || 'An unknown error occurred.');
            }

            // --- START: STREAM HANDLING ---
            resultText.classList.remove('hidden');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                resultText.textContent += chunk;
            }
            // --- END: STREAM HANDLING ---

        } catch (error) {
            resultText.textContent = `Error: ${error.message}`;
            resultText.classList.remove('hidden');
        } finally {
            loader.classList.add('hidden');
        }
    };

    const handleImageFile = (file) => {
        if (!file || !file.type.startsWith('image/')) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            imagePreview.src = e.target.result;
            imagePreview.classList.remove('hidden');
            uploadLabel.classList.add('hidden');

            const base64String = e.target.result.split(',')[1];
            const fileData = { image: base64String, mimeType: file.type };
            
            processImage(fileData);
        };
        reader.readAsDataURL(file);
    };

    document.addEventListener('paste', (event) => {
        if (loginOverlay.style.display !== 'none') return;

        const items = (event.clipboardData || window.clipboardData).items;
        for (const item of items) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                handleImageFile(item.getAsFile());
                event.preventDefault();
                return;
            }
        }
    });
});