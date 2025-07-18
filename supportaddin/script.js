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
    // Use the current item's conversation ID as a default for Conversation ID and Task ID.
    // These will be overwritten when loading existing metadata.
    const convId = item.conversationId || "";
    document.getElementById("conversationId").value = convId;
    document.getElementById("taskId").value = convId;

    // Setup dynamic category options
    document.getElementById("userType").addEventListener("change", populateCategoryOptions);
    populateCategoryOptions(); // initialize category select with default options

    // Load existing metadata from the item's custom properties
    loadMetadata();

    // Bind click handler to save button
    document.getElementById("saveBtn").addEventListener("click", saveMetadata);

    // If the user pins the task pane, respond to selection changes by reloading
    // the metadata for the newly-selected item. This allows the pane to stay
    // open across messages and update its fields accordingly.
    if (Office.context.mailbox && Office.context.mailbox.addHandlerAsync) {
        Office.context.mailbox.addHandlerAsync(Office.EventType.ItemChanged, () => {
            // Update conversation ID defaults and reload saved metadata
            const item = Office.context.mailbox.item;
            const convId = item.conversationId || "";
            document.getElementById("conversationId").value = convId;
            document.getElementById("taskId").value = convId;
            // Reset form before loading new data
            clearForm();
            populateCategoryOptions();
            loadMetadata();
        });
    }
}

// Clear all form fields to default values before loading new metadata.
function clearForm() {
    const ids = ["conversationId","taskId","taskTitle","openedDate","openedBy","userType",
                 "serviceLine","assignedTo","effortEst","effortAct","status","closedDate",
                 "notes","ticketType","ticketCategory","resolution"];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        switch (el.tagName.toLowerCase()) {
            case "select":
                el.selectedIndex = 0;
                break;
            case "textarea":
                el.value = "";
                break;
            default:
                el.value = "";
        }
    });
    // Status message reset
    setStatus("");
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
                // Preserve the ticketCategory value because populating category
                // options will clear existing selections.
                const savedCategory = data.ticketCategory;
                // Set simple properties first (except userType and ticketCategory)
                for (const [id, value] of Object.entries(data)) {
                    if (id === "userType" || id === "ticketCategory") continue;
                    const el = document.getElementById(id);
                    if (el) el.value = value;
                }
                // Set the User Type and populate category options based on it
                if (data.userType) {
                    const userTypeEl = document.getElementById("userType");
                    userTypeEl.value = data.userType;
                    populateCategoryOptions();
                } else {
                    populateCategoryOptions();
                }
                // Now set the ticketCategory after options are populated
                if (savedCategory) {
                    const catEl = document.getElementById("ticketCategory");
                    catEl.value = savedCategory;
                }
                // Set the userType value and populate other selects afterwards
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
