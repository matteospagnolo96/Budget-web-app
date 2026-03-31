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

// Attivazione Firebase Offline Cache Database (Cache Nativa)
db.enablePersistence().catch(err => console.log("Persistenza offline non abilitata:", err.code));

// Data base Locale offline e variabili d'app
let transazioni = JSON.parse(localStorage.getItem('finanze_v5')) || [];
let budgetLimits = JSON.parse(localStorage.getItem('budget_v6')) || {};
let speseRicorrenti = JSON.parse(localStorage.getItem('ricorrenti_v6')) || [];
let lastRecurringCheck = localStorage.getItem('lastCheck_v6') || null;
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

// Listener per aggiornare istantaneamente il grafico se si cambia il Tema dal telefono/PC mentre l'app è aperta
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (chart) {
        chart.destroy();
        chart = null;
    }
    const tabStats = document.getElementById('tab-stats');
    if (tabStats && tabStats.classList.contains('active-tab')) {
        render(); // Ridisegna forzando a rileggere i nuovi codici colore Text
    }
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
            budgetLimits = data.budgetLimits || budgetLimits;
            speseRicorrenti = data.speseRicorrenti || speseRicorrenti;
            lastRecurringCheck = data.lastRecurringCheck || lastRecurringCheck;
            
            // Aggiorna la cache locale così potrai usarla anche offline
            localStorage.setItem('finanze_v5', JSON.stringify(transazioni));
            localStorage.setItem('categorie_v5', JSON.stringify(categorie));
            localStorage.setItem('budget_v6', JSON.stringify(budgetLimits));
            localStorage.setItem('ricorrenti_v6', JSON.stringify(speseRicorrenti));
            if (lastRecurringCheck) localStorage.setItem('lastCheck_v6', lastRecurringCheck);
            
            showToast("Banca dati sincronizzata dal Cloud", "success");
            window.checkRecurringExpenses(); // Il MaggiorDomus controlla gli abbonamenti
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
            budgetLimits: budgetLimits,
            speseRicorrenti: speseRicorrenti,
            lastRecurringCheck: lastRecurringCheck,
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
    localStorage.setItem('budget_v6', JSON.stringify(budgetLimits));
    localStorage.setItem('ricorrenti_v6', JSON.stringify(speseRicorrenti));
    if (lastRecurringCheck) localStorage.setItem('lastCheck_v6', lastRecurringCheck);
    syncToCloud(); 
}

window.setBudgetLimit = function() {
    const cat = document.getElementById('budget-cat-select').value;
    const limit = parseFloat(document.getElementById('budget-limit-val').value);
    if(cat && !isNaN(limit) && limit > 0) {
        budgetLimits[cat] = limit;
        saveLocal();
        render();
        showToast(`Limite di €${limit} impostato per ${cat}`, "success");
        document.getElementById('budget-limit-val').value = '';
    } else {
        showToast("Inserisci un importo valido", "error");
    }
};

window.deleteBudgetLimit = function(cat) {
    if(confirm(`Rimuovere il limite mensile per ${cat}?`)) {
        delete budgetLimits[cat];
        saveLocal();
        render();
        showToast(`Limite rimosso!`, "error");
    }
};

window.checkRecurringExpenses = function() {
    if (speseRicorrenti.length === 0) return;
    
    const today = new Date();
    today.setHours(0,0,0,0);
    
    if (!lastRecurringCheck) {
        lastRecurringCheck = today.toISOString();
        saveLocal();
        return;
    }

    const lastCheckDate = new Date(lastRecurringCheck);
    lastCheckDate.setHours(0,0,0,0);
    if (lastCheckDate.getTime() >= today.getTime()) return; // Già checkato oggi
    
    let operazioniFatte = 0;
    let iterDate = new Date(lastCheckDate);
    iterDate.setDate(iterDate.getDate() + 1); // dal giorno successivo all'ultimo login

    while (iterDate <= today) {
        let maxDaysInMonth = new Date(iterDate.getFullYear(), iterDate.getMonth() + 1, 0).getDate();
        
        speseRicorrenti.forEach(rec => {
            // Se il limite mese è 28 e la spesa è settata il 30, la scala il 28
            let targetDay = rec.giornoDelMese > maxDaysInMonth ? maxDaysInMonth : rec.giornoDelMese;
            
            if (iterDate.getDate() === targetDay) {
                // Inserimento spesa fissa automatica datata
                transazioni.push({
                    id: Date.now() + Math.random(), 
                    importo: rec.importo,
                    tipo: rec.tipo,
                    categoria: rec.categoria,
                    descrizione: rec.descrizione + ' ⭐', // Stellina = Automatica
                    data: iterDate.toISOString().split('T')[0]
                });
                operazioniFatte++;
            }
        });
        iterDate.setDate(iterDate.getDate() + 1);
    }

    if (operazioniFatte > 0) {
        showToast(`🤖 Benvenuto! In tua assenza ho processato ${operazioniFatte} spesa ${operazioniFatte>1?'ricorrenti':'ricorrente'}.`, "success");
    }

    lastRecurringCheck = today.toISOString();
    saveLocal();
    render();
};

window.updateRecCategorySelect = function() {
    const tipo = document.getElementById('rec-tipo').value;
    const select = document.getElementById('rec-cat');
    if(select) select.innerHTML = (categorie[tipo] || []).map(c => `<option value="${c}">${c}</option>`).join('');
};

window.addRecurringExpense = function() {
    const tipo = document.getElementById('rec-tipo').value;
    const categoria = document.getElementById('rec-cat').value;
    const descrizione = document.getElementById('rec-desc').value.trim();
    const importo = Math.abs(parseFloat(document.getElementById('rec-importo').value));
    const giornoDelMese = parseInt(document.getElementById('rec-giorno').value);

    // Valida valori
    if(!categoria || isNaN(importo) || importo <= 0 || isNaN(giornoDelMese) || giornoDelMese < 1 || giornoDelMese > 31) {
        showToast("Compila Titolo, Importo e un Giorno tra 1 e 31", "error");
        return;
    }

    speseRicorrenti.push({ id: Date.now(), tipo, categoria, descrizione, importo, giornoDelMese });
    
    if (!lastRecurringCheck) {
        const t = new Date(); t.setHours(0,0,0,0);
        lastRecurringCheck = t.toISOString();
    }
    
    saveLocal();
    render();
    showToast(`Abbonamento del Giorno ${giornoDelMese} Attivato!`, "success");
    
    document.getElementById('rec-importo').value = '';
    document.getElementById('rec-desc').value = '';
    document.getElementById('rec-giorno').value = '';
};

window.deleteRecurringExpense = function(id) {
    if(confirm("Disattivare il calcolo automatico per questa voce?")) {
        speseRicorrenti = speseRicorrenti.filter(r => r.id !== id);
        saveLocal();
        render();
        showToast("Automazione disattivata", "error");
    }
};

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
    
    const budgetSelect = document.getElementById('budget-cat-select');
    if(budgetSelect) {
        budgetSelect.innerHTML = (categorie['uscita'] || []).map(c => `<option value="${c}">${c}</option>`).join('');
    }
    const budgetList = document.getElementById('budget-limits-list');
    if(budgetList) {
        budgetList.innerHTML = Object.entries(budgetLimits).map(([cat, limit]) => `
            <div class="flex justify-between items-center text-[11px] bg-white p-2 rounded-lg border border-gray-100 shadow-sm mt-2">
                <span class="font-bold text-gray-600">🎯 ${cat}</span>
                <div class="flex items-center gap-3">
                    <span class="font-bold ${limit ? 'text-orange-500' : 'text-gray-700'}">Max €${parseFloat(limit).toFixed(2)}</span>
                    <button onclick="window.deleteBudgetLimit('${cat}')" class="text-gray-400 font-bold py-1 px-2 hover:bg-red-50 hover:text-red-500 rounded transition">Elm</button>
                </div>
            </div>
        `).join('');
    }

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

    // Rendering Liste Automazioni
    const recList = document.getElementById('recurring-list');
    if (recList) {
        if(!document.getElementById('rec-cat').value) window.updateRecCategorySelect(); // Innesco Select la prima volta
        
        recList.innerHTML = speseRicorrenti.sort((a,b)=>a.giornoDelMese-b.giornoDelMese).map(r => `
            <div class="flex justify-between items-center text-[11px] bg-white p-2 rounded-lg border border-gray-100 shadow-sm mt-2 border-l-4 ${r.tipo === 'entrata' ? 'border-l-green-400' : 'border-l-red-400'}">
                <div class="flex flex-col">
                    <span class="font-bold text-gray-700">${r.descrizione} <span class="text-gray-400 font-medium">(${r.categoria})</span></span>
                    <span class="text-gray-400 font-bold uppercase mt-0.5">🗓️ Ogni Giorno ${r.giornoDelMese}</span>
                </div>
                <div class="flex items-center gap-2">
                    <span class="font-bold ${r.tipo === 'entrata' ? 'text-green-500' : 'text-red-500'}">€${r.importo.toFixed(2)}</span>
                    <button onclick="window.deleteRecurringExpense(${r.id})" class="text-gray-400 font-bold px-1.5 py-1 hover:bg-gray-100 hover:text-red-500 rounded transition">✕</button>
                </div>
            </div>
        `).join('');
    }

    // 1. Dati del Periodo (Per Box Statistiche in alto e Grafico a Torta)
    const filtrati_periodo = transazioni.filter(t => {
        const d = new Date(t.data);
        return viewType === 'mensile' ? (d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear()) : (d.getFullYear() === currentDate.getFullYear());
    });

    // 2. Dati della Ricerca (Per la Lista in basso e il Box Trovati)
    const q = (document.getElementById('searchTerm')?.value || '').toLowerCase();
    const filtrati_ricerca = filtrati_periodo.filter(t => {
        if (!q) return true;
        
        return t.categoria.toLowerCase().includes(q) || 
               (t.descrizione || '').toLowerCase().includes(q) || 
               t.importo.toString().includes(q);
    });

    let ent = 0, usc = 0;
    const stats = {};
    const list = document.getElementById('lista-transazioni');
    let htmlContent = '';
    
    // Calcolo bilancio Main Cards e Chart su TUTTO il mese/anno normale (filtrati_periodo)
    filtrati_periodo.forEach(t => {
        if(t.tipo === 'entrata') ent += t.importo;
        else {
            usc += t.importo;
            stats[t.categoria] = (stats[t.categoria] || 0) + t.importo;
        }
    });
    
    // Aggiornamento Box Sommario Ricerca usa SOLO i dati filtrati_ricerca
    const searchSummary = document.getElementById('search-summary');
    if (searchSummary) {
        if (q) {
            let searchedSum = 0;
            filtrati_ricerca.forEach(t => {
                searchedSum += t.tipo === 'uscita' ? -t.importo : t.importo;
            });
            let txtColorMatch = searchedSum >= 0 ? 'text-green-600' : 'text-red-600';
            
            searchSummary.classList.remove('hidden');
            searchSummary.classList.add('flex', 'justify-between');
            searchSummary.innerHTML = `<span>Trovati: ${filtrati_ricerca.length}</span> <span class="${txtColorMatch}">Totale: € ${Math.abs(searchedSum).toFixed(2)}</span>`;
        } else {
            searchSummary.classList.add('hidden');
            searchSummary.classList.remove('flex', 'justify-between');
        }
    }

    // Costruzione Lista HTML solo per i risultati di ricerca
    filtrati_ricerca.sort((a,b) => new Date(b.data) - new Date(a.data)).forEach(t => {
        
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
    
    // Controlla il tema attuale e cambia i colori dei testi e bordi interni al grafico
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const textColor = isDark ? '#f8fafc' : '#64748b';

    chart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: keys,
            datasets: [{ 
                data: Object.values(stats), 
                backgroundColor: chartColors, 
                borderWidth: isDark ? 0 : 2, 
                borderColor: isDark ? 'transparent' : '#ffffff' 
            }]
        },
        options: { 
            responsive: true,
            maintainAspectRatio: false,
            color: textColor,
            plugins: { 
                legend: { 
                    position: 'bottom', 
                    labels: { 
                        color: textColor,
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
                                    strokeStyle: isDark ? 'transparent' : '#ffffff',
                                    lineWidth: 1,
                                    fontColor: textColor,
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
        let barColor = baseColors[i % baseColors.length];
        let infoTesto = `€ ${stats[c].toFixed(2)}`;
        let limit = budgetLimits[c];

        // Se c'è un Limite impostato, calcoliamo la saturazione (Plafond)
        if (limit && viewType === 'mensile') {
            const percUsata = (stats[c] / limit) * 100;
            p = Math.min(percUsata, 100).toFixed(1);
            
            if (percUsata >= 100) {
                barColor = '#ef4444'; // Sforato (Rosso Lampante)
            } else if (percUsata >= 80) {
                barColor = '#f97316'; // Allerta (Arancione)
            } else {
                barColor = '#10b981'; // Sicuro (Verde)
            }
            
            infoTesto = `€ ${stats[c].toFixed(2)} <span class="text-gray-400 font-normal"> / € ${limit.toFixed(2)}</span>`;
        } else if (limit && viewType === 'annuale') {
            // Se vista annuale, moltiplichiamo il budget x 12 come limite indicativo per calcolare il progress
            const annualLimit = limit * 12;
            const percUsata = (stats[c] / annualLimit) * 100;
            p = Math.min(percUsata, 100).toFixed(1);
            
            if (percUsata >= 100) barColor = '#ef4444';
            else if (percUsata >= 80) barColor = '#f97316';
            else barColor = '#10b981';
            
            infoTesto = `€ ${stats[c].toFixed(2)} <span class="text-gray-400 font-normal"> / € ${annualLimit.toFixed(2)} (Stima Ann.)</span>`;
        }

        htmlContent += `
            <div class="space-y-1">
                <div class="flex justify-between items-end text-[11px] mt-2 mb-1">
                    <span class="font-medium flex items-center gap-1">${limit ? '🎯' : ''} ${c}</span>
                    <span class="font-bold text-gray-700">${infoTesto}</span>
                </div>
                <div class="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                    <div class="h-2 rounded-full transition-all duration-700 ease-out" style="width:${p}%; background-color: ${barColor}"></div>
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

window.exportCSV = function() {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "ID,Data,Tipo,Categoria,Importo,Descrizione\r\n";
    
    // Esporta solo le transazioni del periodo attualmente visualizzato
    const filtrati = transazioni.filter(t => {
        const d = new Date(t.data);
        return viewType === 'mensile' ? (d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear()) : (d.getFullYear() === currentDate.getFullYear());
    });

    filtrati.sort((a,b) => new Date(b.data) - new Date(a.data)).forEach(t => {
        let row = `${t.id},${t.data},${t.tipo},${t.categoria},${parseFloat(t.importo).toFixed(2)},"${(t.descrizione || '').replace(/"/g, '""')}"`;
        csvContent += row + "\r\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `budget_export_${viewType}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Esportazione Excel Completata!", "success");
};
