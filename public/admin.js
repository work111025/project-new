// file: public/admin.js
const AdminApp = {
    state: { adminKey: null, toastTimeout: null },
    elements: {
        loginDialog: document.getElementById('loginDialog'),
        loginForm: document.getElementById('loginForm'),
        loginError: document.getElementById('loginError'),
        adminKeyInput: document.getElementById('adminKeyInput'),
        adminPanel: document.getElementById('adminPanel'),
        loader: document.getElementById('loader'),
        keysTableBody: document.getElementById('keysTableBody'),
        noKeysMessage: document.getElementById('noKeysMessage'),
        createKeyForm: document.getElementById('createKeyForm'),
        keyNameInput: document.getElementById('keyNameInput'),
        validityDaysInput: document.getElementById('validityDaysInput'),
        newKeyContainer: document.getElementById('newKeyContainer'),
        newKeyDisplay: document.getElementById('newKeyDisplay'),
        copyKeyBtn: document.getElementById('copyKeyBtn'),
        toast: document.getElementById('toast'),
        keyRowTemplate: document.getElementById('keyRowTemplate'),
        refreshBtn: document.getElementById('refreshBtn'),
    },

    init() {
        this.addEventListeners();
        this.state.adminKey = sessionStorage.getItem('adminKey');
        if (this.state.adminKey) {
            this.showAdminPanel();
        } else {
            this.elements.loginDialog.showModal();
        }
    },

    addEventListeners() {
        this.elements.loginForm.addEventListener('submit', this.handleLogin.bind(this));
        this.elements.createKeyForm.addEventListener('submit', this.handleCreateKey.bind(this));
        this.elements.copyKeyBtn.addEventListener('click', this.handleCopyKey.bind(this));
        this.elements.refreshBtn.addEventListener('click', this.handleRefresh.bind(this));
    },

    async apiCall(endpoint, options = {}) {
        const headers = { 'Content-Type': 'application/json', 'X-Admin-Key': this.state.adminKey, ...options.headers };
        const response = await fetch(endpoint, { ...options, headers });
        if (response.status === 401) {
            sessionStorage.removeItem('adminKey');
            this.state.adminKey = null;
            document.body.classList.remove('authenticated');
            this.elements.loginError.textContent = 'Session expired. Please log in again.';
            this.elements.loginDialog.showModal();
            throw new Error('Unauthorized');
        }
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'An unknown error occurred' }));
            throw new Error(errorData.error);
        }
        return response.json();
    },

    async handleLogin(event) {
        event.preventDefault();
        const loginButton = this.elements.loginForm.querySelector('button[type="submit"]');
        loginButton.disabled = true;
        loginButton.textContent = 'Logging In...';

        const key = this.elements.adminKeyInput.value.trim();
        if (!key) {
            loginButton.disabled = false;
            loginButton.textContent = 'Login';
            return;
        }
        this.state.adminKey = key;
        this.elements.loginError.textContent = '';
        try {
            await this.fetchAndDisplayKeys();
            sessionStorage.setItem('adminKey', this.state.adminKey);
            this.elements.loginDialog.close();
            this.showAdminPanel();
        } catch (error) {
            this.elements.loginError.textContent = 'Invalid admin key.';
            this.state.adminKey = null;
        } finally {
            loginButton.disabled = false;
            loginButton.textContent = 'Login';
        }
    },
    
    showAdminPanel() {
        document.body.classList.add('authenticated');
        this.fetchAndDisplayKeys();
    },

    async fetchAndDisplayKeys() {
        this.setLoading(true);
        try {
            const keys = await this.apiCall('/admin/api/keys');
            this.renderTable(keys);
        } catch (error) {
            if (error.message !== 'Unauthorized') this.showToast(`Failed to fetch keys: ${error.message}`, 'error');
        } finally {
            this.setLoading(false);
        }
    },

    async handleRefresh() {
        this.showToast('Refreshing data and flushing server cache...', 'success');
        try {
            await this.apiCall('/admin/api/cache/flush', { method: 'POST' });
        } catch (error) {
            this.showToast(`Failed to flush cache: ${error.message}`, 'error');
        } finally {
            await this.fetchAndDisplayKeys();
        }
    },

    async handleCreateKey(event) {
        event.preventDefault();
        const name = this.elements.keyNameInput.value.trim();
        const validityDays = this.elements.validityDaysInput.value;

        if (!name) {
            this.showToast('Please fill out all fields.', 'error');
            return;
        }
        try {
            const { key } = await this.apiCall('/admin/api/keys', {
                method: 'POST',
                body: JSON.stringify({ name, validityDays }),
            });
            this.elements.newKeyDisplay.textContent = key;
            this.elements.newKeyContainer.classList.remove('hidden');
            this.showToast('New key created successfully!', 'success');
            this.elements.createKeyForm.reset();
            this.fetchAndDisplayKeys();
        } catch (error) {
            this.showToast(`Failed to create key: ${error.message}`, 'error');
        }
    },

    async handleDeleteKey(creationDate) {
        if (!confirm('Are you sure you want to delete this key? This action is irreversible.')) {
            return;
        }
        try {
            await this.apiCall('/admin/api/keys', { method: 'DELETE', body: JSON.stringify({ creationDate }) });
            this.showToast('Key deleted successfully.', 'success');
            this.fetchAndDisplayKeys();
        } catch (error) {
            this.showToast(`Failed to delete key: ${error.message}`, 'error');
        }
    },

    async handleUpdateExpiration(creationDate, newExpirationDate) {
        try {
            await this.apiCall('/admin/api/keys/expiration', {
                method: 'PATCH',
                body: JSON.stringify({ creationDate, newExpirationDate }),
            });
            this.showToast('Expiration date updated.', 'success');
            this.fetchAndDisplayKeys();
        } catch (error) {
            this.showToast(`Update failed: ${error.message}`, 'error');
        }
    },

    async handleUpdateName(creationDate, newName) {
        try {
            await this.apiCall('/admin/api/keys/name', {
                method: 'PATCH',
                body: JSON.stringify({ creationDate, newName }),
            });
            this.showToast('Name updated.', 'success');
            this.fetchAndDisplayKeys();
        } catch (error) {
            this.showToast(`Update failed: ${error.message}`, 'error');
        }
    },
    
    handleCopyKey() {
        navigator.clipboard.writeText(this.elements.newKeyDisplay.textContent)
            .then(() => this.showToast('Key copied to clipboard!', 'success'))
            .catch(() => this.showToast('Failed to copy key.', 'error'));
    },

    renderTable(keys) {
        this.elements.keysTableBody.innerHTML = '';
        this.elements.noKeysMessage.classList.toggle('hidden', keys.length > 0);
        keys.sort((a, b) => new Date(b.creationDate) - new Date(a.creationDate));

        keys.forEach(key => {
            const row = this.elements.keyRowTemplate.content.cloneNode(true);
            const tr = row.querySelector('tr');
            tr.dataset.creationDate = key.creationDate;
            const cells = row.querySelectorAll('td');
            const isExpired = new Date() > new Date(key.expirationDate);
            
            row.querySelector('.status').textContent = isExpired ? 'Expired' : 'Active';
            row.querySelector('.status').className = `status ${isExpired ? 'expired' : 'active'}`;
            
            const nameCell = cells[1];
            const nameText = nameCell.querySelector('.name-text');
            const editNameBtn = nameCell.querySelector('.edit-name-btn');
            const nameEditControls = nameCell.querySelector('.edit-controls');
            const nameInput = nameEditControls.querySelector('.name-input');
            nameText.textContent = key.name;
            const toggleNameEdit = (isEditing) => {
                nameText.classList.toggle('hidden', isEditing);
                editNameBtn.classList.toggle('hidden', isEditing);
                nameEditControls.classList.toggle('hidden', !isEditing);
            };
            editNameBtn.addEventListener('click', () => {
                nameInput.value = key.name;
                toggleNameEdit(true);
            });
            nameEditControls.querySelector('.cancel-btn').addEventListener('click', () => toggleNameEdit(false));
            nameEditControls.querySelector('.save-btn').addEventListener('click', () => {
                const newName = nameInput.value.trim();
                if (newName && newName !== key.name) this.handleUpdateName(key.creationDate, newName);
                else toggleNameEdit(false);
            });

            cells[2].textContent = new Date(key.creationDate).toLocaleString();

            const expCell = cells[3];
            const dateText = expCell.querySelector('.date-text');
            const editDateBtn = expCell.querySelector('.edit-date-btn');
            const dateEditControls = expCell.querySelector('.edit-controls');
            const dateInput = dateEditControls.querySelector('.date-input');
            dateText.textContent = new Date(key.expirationDate).toLocaleString();
            const toggleDateEdit = (isEditing) => {
                dateText.classList.toggle('hidden', isEditing);
                editDateBtn.classList.toggle('hidden', isEditing);
                dateEditControls.classList.toggle('hidden', !isEditing);
            };
            editDateBtn.addEventListener('click', () => {
                dateInput.value = new Date(key.expirationDate).toISOString().split('T')[0];
                toggleDateEdit(true);
            });
            dateEditControls.querySelector('.cancel-btn').addEventListener('click', () => toggleDateEdit(false));
            dateEditControls.querySelector('.save-btn').addEventListener('click', () => {
                if (dateInput.value) this.handleUpdateExpiration(key.creationDate, dateInput.value);
            });

            cells[4].textContent = key.requestCount;
            cells[5].textContent = key.lastUsedIp || 'N/A';
            
            const lastDeviceCell = cells[6];
            const userAgent = key.lastUsedUserAgent;
            if (userAgent) {
                lastDeviceCell.textContent = userAgent.substring(0, 40) + (userAgent.length > 40 ? '...' : '');
                lastDeviceCell.title = userAgent;
            } else {
                lastDeviceCell.textContent = 'N/A';
            }

            row.querySelector('.delete-btn').addEventListener('click', () => this.handleDeleteKey(key.creationDate));

            this.elements.keysTableBody.appendChild(row);
        });
    },

    setLoading(isLoading) {
        this.elements.loader.classList.toggle('hidden', !isLoading);
        this.elements.keysTableBody.parentElement.classList.toggle('hidden', isLoading);
    },

    showToast(message, type = 'success') {
        clearTimeout(this.state.toastTimeout);
        const { toast } = this.elements;
        toast.textContent = message;
        toast.className = `toast show ${type}`;
        this.state.toastTimeout = setTimeout(() => { toast.className = 'toast'; }, 3000);
    },
};

document.addEventListener('DOMContentLoaded', () => AdminApp.init());