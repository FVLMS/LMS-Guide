/* global Office */
const PROP_KEY = "com.lms.helpdesk";

Office.onReady(() => {
    Office.context.mailbox.item.getConversationAsync((result) => {
        // Conversation ID accessible directly via item.conversationId; fallback for older builds
    });
    initForm();
});

function initForm() {
    const item = Office.context.mailbox.item;
    const convId = item.conversationId || "";    
    document.getElementById("conversationId").value = convId;
    document.getElementById("taskId").value = convId; // default, may be overridden by loaded data

    // Setup dynamic category options
    document.getElementById("userType").addEventListener("change", populateCategoryOptions);
    populateCategoryOptions(); // init with default

    // Load existing metadata
    loadMetadata();
    document.getElementById("saveBtn").addEventListener("click", saveMetadata);
}

function setStatus(msg) {
    document.getElementById("statusMsg").textContent = msg;
}

function populateCategoryOptions() {
    const userType = document.getElementById("userType").value;
    const catSelect = document.getElementById("ticketCategory");
    const options = {
        "User": ["Login", "Access Training", "Self Enroll", "Transcript", "Certificate", "Other"],
        "Manager": ["Security Access", "Missing Account", "Assignment", "Removal", "Reporting", "Content", "Other"],
        "Proxy": ["Security Access", "Missing Account", "Assignment", "Removal", "Reporting", "Content", "Other"],
        "Educator": ["Security Access", "Missing Account", "Assignment", "Removal", "Reporting", "Content", "Other"],
        "SME": ["New eLearning", "update eLearning", "file request", "Other"]
    };

    const newOpts = options[userType] || [];
    // clear existing
    catSelect.innerHTML = "";
    if (newOpts.length === 0) {
        catSelect.innerHTML = '<option value="">--select User Type First--</option>';
        return;
    }
    catSelect.innerHTML = '<option value="">--select--</option>';
    newOpts.forEach(o => {
        const opt = document.createElement("option");
        opt.text = o;
        opt.value = o;
        catSelect.add(opt);
    });
}

function loadMetadata() {
    Office.context.mailbox.item.loadCustomPropertiesAsync((asyncResult) => {
        if (asyncResult.status !== Office.AsyncResultStatus.Succeeded) {
            setStatus("Failed to load properties");
            return;
        }
        const customProps = asyncResult.value;
        const json = customProps.get(PROP_KEY);
        if (json) {
            try {
                const data = JSON.parse(json);
                for (const [id, value] of Object.entries(data)) {
                    const el = document.getElementById(id);
                    if (el) el.value = value;
                }
                populateCategoryOptions(); // ensure categories reflect stored userType
                setStatus("Loaded");
            } catch (e) {
                console.error(e);
                setStatus("Failed to parse data");
            }
        } else {
            setStatus("No metadata yet");
        }
    });
}

function collectData() {
    const ids = ["conversationId","taskId","taskTitle","openedDate","openedBy","userType","serviceLine",
                 "assignedTo","effortEst","effortAct","status","closedDate","notes","ticketType",
                 "ticketCategory","resolution"];
    const data = {};
    ids.forEach(id=>{
        const el = document.getElementById(id);
        if (el) data[id] = el.value;
    });
    return data;
}

function saveMetadata() {
    const data = collectData();
    Office.context.mailbox.item.loadCustomPropertiesAsync((asyncResult) => {
        if (asyncResult.status !== Office.AsyncResultStatus.Succeeded) {
            setStatus("Failed to load custom properties");
            return;
        }
        const customProps = asyncResult.value;
        customProps.set(PROP_KEY, JSON.stringify(data));
        customProps.saveAsync((saveResult) => {
            if (saveResult.status === Office.AsyncResultStatus.Succeeded) {
                setStatus("Saved!");
            } else {
                setStatus("Save failed");
            }
        });
    });
}
