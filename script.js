const firebaseConfig = {
    apiKey: "AIzaSyAGeApDKAzoNuAuyQU8u_a7dqJKsv2--m8",
    authDomain: "bilancio-603f4.firebaseapp.com",
    projectId: "bilancio-603f4",
    storageBucket: "bilancio-603f4.firebasestorage.app",
    messagingSenderId: "726872482285",
    appId: "1:726872482285:web:b519c8fb64298c340bc7e4",
    measurementId: "G-WKWWQE6LDT"
};

// Inizializza Firebase usando la libreria globale Compatibile con i file locali
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Data base Locale offline e variabili d'app
let transazioni = JSON.parse(localStorage.getItem('finanze_v5')) || [];
let categorie = JSON.parse(localStorage.getItem('categorie_v5')) || {
    uscita: ['🛒 Cibo', '🚗 Trasporti', '🏠 Casa', '🍕 Svago', '💊 Salute'],
    entrata: ['💰 Stipendio', '📈 Investimenti', '🎁 Regalo']
};
let currentUser = null;
let viewType = 'mensile';
let currentDate = new Date();
let chart;

const baseColors = [
    '#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', 
    '#06b6d4', '#f59e0b', '#ec4899', '#6366f1', '#14b8a6'
];

window.addEventListener('load', () => {
    document.getElementById('data-input').valueAsDate = new Date();
});

// Funzione Notifiche
function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// ----------------------------------------------------
// FIREBASE AUTHENTICATION E SINCRONIZZAZIONE (COMPAT)
// ----------------------------------------------------
auth.onAuthStateChanged(async (user) => {
    const authContainer = document.getElementById('auth-container');
    const appContainer = document.getElementById('app-container');
    
    if (user) {
        // Utente LOGGATO
        currentUser = user;
        authContainer.classList.add('hidden-app');
        appContainer.classList.remove('hidden-app');
        document.getElementById('profile-email').innerText = user.email;
        
        await syncFromCloud();
    } else {
        // Utente NON LOGGATO
        currentUser = null;
        authContainer.classList.remove('hidden-app');
        appContainer.classList.add('hidden-app');
    }
});

document.getElementById('btn-login').addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value.trim();
    const pass = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('auth-error');
    if(!email || !pass) { errorEl.innerText = "Inserisci un'Email e la Password."; errorEl.classList.remove('hidden'); return; }
    
    try {
        await auth.signInWithEmailAndPassword(email, pass);
        errorEl.classList.add('hidden');
    } catch(err) {
        errorEl.innerText = "Credenziali errate o account non esistente.";
        errorEl.classList.remove('hidden');
    }
});

document.getElementById('btn-signup').addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value.trim();
    const pass = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('auth-error');
    if(!email || pass.length < 6) { errorEl.innerText = "Email e Password invalida (min. 6 caratteri)."; errorEl.classList.remove('hidden'); return; }
    
    try {
        await auth.createUserWithEmailAndPassword(email, pass);
        errorEl.classList.add('hidden');
        showToast("Nuovo account creato con successo!", "success");
    } catch(err) {
        errorEl.innerText = "Ops! Errore: " + err.message;
        errorEl.classList.remove('hidden');
    }
});

window.authLogout = () => {
    if(confirm("Sei sicuro di voler scollegare questo dispositivo?")) {
        auth.signOut();
    }
};

// Funzione principale di Pull Database
async function syncFromCloud() {
    if (!currentUser) return;
    try {
        const docRef = db.collection("users").doc(currentUser.uid);
        const docSnap = await docRef.get();
        
        if (docSnap.exists) {
            const data = docSnap.data();
            transazioni = data.transazioni || [];
            categorie = data.categorie || categorie;
            
            // Aggiorna la cache locale così potrai usarla anche offline
            localStorage.setItem('finanze_v5', JSON.stringify(transazioni));
            localStorage.setItem('categorie_v5', JSON.stringify(categorie));
            
            showToast("Banca dati sincronizzata dal Cloud", "success");
        } else {
            // DOCUMENTO NON ESISTE = Primo Login Assoluto. ESEGUI MIGRAZIONE DATI LOCALI.
            if (transazioni.length > 0) {
                await syncToCloud(); 
                showToast("Dati Locali vecchi trasferiti sul Cloud con successo!", "success");
            } else {
                await syncToCloud(); 
            }
        }
    } catch (err) {
        showToast("Errore lettura database Cloud. Uso dati Locali.", "error");
        console.error(err);
    }
    
    render();
}

// Funzione automatica di Push Database (Upsert)
async function syncToCloud() {
    if (!currentUser) return;
    try {
        const docRef = db.collection("users").doc(currentUser.uid);
        await docRef.set({
            transazioni: transazioni,
            categorie: categorie,
            updatedAt: new Date().toISOString()
        });
        document.getElementById('cloud-status').innerText = `Sincronizzazione Cloud Automatica ✔️`;
    } catch (err) {
        document.getElementById('cloud-status').innerText = `Sync Cloud Fallita / Offline ❌`;
        console.error(err);
    }
}

function saveLocal() {
    localStorage.setItem('finanze_v5', JSON.stringify(transazioni));
    localStorage.setItem('categorie_v5', JSON.stringify(categorie));
    syncToCloud(); 
}

// ----------------------------------------------------
// UI APP LOGIC
// ----------------------------------------------------

window.switchTab = function(tab) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active-tab'));
    document.querySelectorAll('.btn-tab').forEach(el => {
        el.classList.remove('active', 'text-white');
        el.classList.add('text-gray-500');
    });
    
    document.getElementById('tab-' + tab).classList.add('active-tab');
    const btn = document.getElementById('tab-btn-' + tab);
    btn.classList.add('active');
    btn.classList.remove('text-gray-500');
    
    if(tab === 'stats' && chart) {
        chart.resize();
    }
    render();
};

window.updateCategorySelect = function() {
    const tipo = document.getElementById('tipo').value;
    const select = document.getElementById('categoria-select');
    const options = [...(categorie[tipo] || [])];
    
    const idEditing = document.getElementById('edit-id').value;
    if (idEditing) {
        const transEditing = transazioni.find(t => t.id == idEditing);
        if (transEditing && transEditing.tipo === tipo && !options.includes(transEditing.categoria)) {
            options.unshift(transEditing.categoria);
        }
    }
    select.innerHTML = options.map(c => `<option value="${c}">${c}</option>`).join('');
};

window.saveTransaction = function() {
    const id = document.getElementById('edit-id').value;
    let rawImporto = parseFloat(document.getElementById('importo').value);
    const importo = Math.abs(rawImporto);
    const tipo = document.getElementById('tipo').value;
    const categoria = document.getElementById('categoria-select').value;
    const descrizione = document.getElementById('descrizione').value.trim();
    const data = document.getElementById('data-input').value;

    if(isNaN(importo) || importo <= 0 || !data) {
        showToast("Inserisci un importo valido e la data", "error");
        return;
    }

    if(id) {
        const index = transazioni.findIndex(t => t.id == id);
        transazioni[index] = { ...transazioni[index], importo, tipo, categoria, descrizione, data };
        showToast("Movimento aggiornato!");
    } else {
        transazioni.push({ id: Date.now(), importo, tipo, categoria, descrizione, data });
        showToast("Nuovo movimento registrato!");
    }

    saveLocal();
    resetForm();
    render();
};

window.deleteTransaction = function() {
    const id = document.getElementById('edit-id').value;
    if (!id) return;
    
    if (confirm("Vuoi davvero eliminare questo movimento?")) {
        transazioni = transazioni.filter(t => t.id != id);
        saveLocal();
        showToast("Movimento eliminato!", "error");
        resetForm();
        render();
    }
};

window.editTrans = function(id) {
    const t = transazioni.find(item => item.id == id);
    if(!t) return;
    
    document.getElementById('edit-id').value = t.id;
    document.getElementById('tipo').value = t.tipo;
    
    window.updateCategorySelect();
    
    document.getElementById('categoria-select').value = t.categoria;
    document.getElementById('importo').value = t.importo;
    document.getElementById('descrizione').value = t.descrizione || '';
    document.getElementById('data-input').value = t.data;
    
    document.getElementById('form-title').innerText = "Modifica Movimento";
    document.getElementById('btn-save').innerText = "Aggiorna";
    document.getElementById('btn-container-edit').classList.remove('hidden');
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.resetForm = function() {
    document.getElementById('edit-id').value = '';
    document.getElementById('importo').value = '';
    document.getElementById('descrizione').value = '';
    document.getElementById('data-input').valueAsDate = new Date();
    document.getElementById('form-title').innerText = "Aggiungi Movimento";
    document.getElementById('btn-save').innerText = "Registra";
    document.getElementById('btn-container-edit').classList.add('hidden');
};

window.deleteCategory = function(tipo, index) {
    if(confirm("Eliminare questa categoria?")) { 
        categorie[tipo].splice(index, 1); 
        saveLocal(); 
        render(); 
        showToast("Categoria eliminata!", "success");
    }
};

window.addCustomCategory = function() {
    const nome = document.getElementById('nuova-cat-nome').value.trim();
    const tipo = document.getElementById('nuova-cat-tipo').value;
    if(nome && !categorie[tipo].includes(nome)) { 
        categorie[tipo].push(nome); 
        saveLocal(); 
        render(); 
        showToast("Categoria aggiunta!", "success");
    }
    document.getElementById('nuova-cat-nome').value = '';
};

window.navigate = function(dir) {
    if (viewType === 'mensile') {
        currentDate.setMonth(currentDate.getMonth() + dir);
    } else {
        currentDate.setFullYear(currentDate.getFullYear() + dir);
    }
    render();
};

window.changeView = function(v) {
    viewType = v;
    document.getElementById('v-m').className = v === 'mensile' ? 'text-gray-800' : 'text-gray-400';
    document.getElementById('v-a').className = v === 'annuale' ? 'text-gray-800' : 'text-gray-400';
    render();
};

function render() {
    const label = document.getElementById('current-period-label');
    label.innerText = currentDate.toLocaleDateString('it-IT', viewType === 'mensile' ? {month:'long', year:'numeric'} : {year:'numeric'});
    window.updateCategorySelect();
    
    const catList = document.getElementById('categories-manage-list');
    let catListHTML = '';
    ['uscita', 'entrata'].forEach(t => {
        (categorie[t] || []).forEach((c, idx) => {
            catListHTML += `<div class="flex justify-between items-center text-xs bg-white p-2 rounded border border-gray-100">
                <span>${t === 'entrata' ? '🟢' : '🔴'} ${c}</span>
                <button onclick="window.deleteCategory('${t}', ${idx})" class="text-gray-400 font-bold p-1 hover:text-red-500">✕</button>
            </div>`;
        });
    });
    catList.innerHTML = catListHTML;

    const filtrati = transazioni.filter(t => {
        const d = new Date(t.data);
        return viewType === 'mensile' ? (d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear()) : (d.getFullYear() === currentDate.getFullYear());
    });

    let ent = 0, usc = 0;
    const stats = {};
    const list = document.getElementById('lista-transazioni');
    
    let htmlContent = '';

    filtrati.sort((a,b) => new Date(b.data) - new Date(a.data)).forEach(t => {
        if(t.tipo === 'entrata') ent += t.importo;
        else {
            usc += t.importo;
            stats[t.categoria] = (stats[t.categoria] || 0) + t.importo;
        }
        
        let colorClass = t.tipo === 'entrata' ? 'border-green-500' : 'border-red-500';
        let amountColorClass = t.tipo === 'entrata' ? 'text-green-600' : 'text-red-600';
        let descHTML = t.descrizione ? `<p class="text-[10px] text-gray-500 italic mt-0.5">${t.descrizione}</p>` : '';
        
        htmlContent += `
        <div onclick="window.editTrans(${t.id})" class="transazione-item card p-3 flex justify-between items-center text-sm cursor-pointer hover:bg-gray-50 border-l-4 ${colorClass}">
            <div class="flex-1 pr-4 pointer-events-none">
                <p class="text-[9px] text-gray-400 font-bold uppercase">${t.data}</p>
                <p class="font-bold text-gray-700">${t.categoria}</p>
                ${descHTML}
            </div>
            <span class="${amountColorClass} font-black pointer-events-none">€${t.importo.toFixed(2)}</span>
        </div>`;
    });
    
    list.innerHTML = htmlContent;

    document.getElementById('tot-entrate').innerText = `€ ${ent.toFixed(2)}`;
    document.getElementById('tot-uscite').innerText = `€ ${usc.toFixed(2)}`;
    document.getElementById('tot-risparmi').innerText = `€ ${(ent - usc).toFixed(2)}`;
    
    updateChart(stats, usc);
    renderStatsDetails(stats, usc);
}

function updateChart(stats, total) {
    const canvas = document.getElementById('expenseChart');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const keys = Object.keys(stats);
    if(keys.length === 0) {
        if(chart) chart.destroy();
        return;
    }

    const chartColors = keys.map((_, i) => baseColors[i % baseColors.length]);

    if(chart) chart.destroy();

    chart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: keys,
            datasets: [{ 
                data: Object.values(stats), 
                backgroundColor: chartColors, 
                borderWidth: 2, 
                borderColor: '#ffffff' 
            }]
        },
        options: { 
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { 
                    position: 'bottom', 
                    labels: { 
                        boxWidth: 12, 
                        font: {size: 11},
                        generateLabels: (chart) => {
                            const data = chart.data;
                            if(!data.labels || data.labels.length === 0) return [];
                            return data.labels.map((label, i) => {
                                const value = data.datasets[0].data[i];
                                const percentage = total ? ((value / total) * 100).toFixed(1) + '%' : '0%';
                                return {
                                    text: `${label} (${percentage})`,
                                    fillStyle: data.datasets[0].backgroundColor[i],
                                    strokeStyle: '#ffffff',
                                    lineWidth: 1,
                                    hidden: false,
                                    index: i
                                };
                            });
                        }
                    } 
                }
            } 
        }
    });
}

function renderStatsDetails(stats, total) {
    const container = document.getElementById('category-breakdown');
    if(!container) return;
    
    let htmlContent = '<h3 class="text-xs font-bold text-gray-400 uppercase border-b pb-2">Analisi Spese</h3>';
    
    if(total === 0) { 
        container.innerHTML = htmlContent + '<p class="text-center text-gray-400 py-4 text-sm">Nessuna spesa nel periodo</p>'; 
        return; 
    }
    
    const keys = Object.keys(stats);
    keys.forEach((c, i) => {
        let p = ((stats[c]/total)*100).toFixed(1);
        const barColor = baseColors[i % baseColors.length];
        htmlContent += `
            <div class="space-y-1">
                <div class="flex justify-between text-xs mt-2">
                    <span>${c}</span>
                    <span class="font-bold">€${stats[c].toFixed(2)}</span>
                </div>
                <div class="w-full bg-gray-100 h-1.5 rounded-full">
                    <div class="h-1.5 rounded-full" style="width:${p}%; background-color: ${barColor}"></div>
                </div>
            </div>`;
    });
    
    container.innerHTML = htmlContent;
}

window.exportData = function() {
    const blob = new Blob([JSON.stringify({transazioni, categorie})], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `finance_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    showToast("Backup esportato!", "success");
};

window.importData = function(event) {
    if (!event.target.files.length) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            if(confirm("L'importazione sovrascriverà le transazioni correnti e invierà i dati sul Cloud. Continuare?")) {
                transazioni = imported.transazioni || []; 
                categorie = imported.categorie || categorie;
                saveLocal(); 
                render();
                showToast("Dati importati e inviati a Firebase", "success");
            }
        } catch (error) {
            showToast("Errore lettura file", "error");
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(event.target.files[0]);
};
