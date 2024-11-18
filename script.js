let contentData = null;
let currentMode = 'step'; // Default mode
let overlayClicked = false; // Track if overlay has been clicked globally
let currentStepNumber = 1; // Track the current step globally
let currentOverlay = false;
let overlayElement = null;  // Add this to track the overlay element
const baseUrl = 'https://mnfhs.sharepoint.com/sites/LMSTeam/LMS Public/CornerstoneTraining/';
const urlParams = new URLSearchParams(window.location.search);
const title = urlParams.get('title');
const jsonUrl = `/content/${title}.json`;
const assetsUrl = `${baseUrl}${title}/`;

document.addEventListener('DOMContentLoaded', () => {
    const stepByStep = document.getElementById('stepByStep');
    const playAll = document.getElementById('playAll');
    const referenceMode = document.getElementById('referenceMode');
    const detailsContainer = document.getElementById('detailsContainer');
    const mediaStack = document.getElementById('mediaStack');

    if (!stepByStep || !playAll || !referenceMode || !detailsContainer || !mediaStack) {
        console.error('Required DOM elements not found');
        return;
    }
});

function switchMode(mode) {
    currentMode = mode;

    document.getElementById('stepByStep').classList.toggle('active', mode === 'step');
    document.getElementById('playAll').classList.toggle('active', mode === 'auto');
    document.getElementById('referenceMode').classList.toggle('active', mode === 'reference');

    
    if (mode === 'auto') {
        detailsContainer.style.display = 'none';
        mediaStack.classList.remove('small-media');
        setTimeout(() => {
            selectStep(currentStepNumber);
        }, 0);
        const overlay = document.createElement('div');
        overlay.className = 'video-overlay';
        overlayClicked = true; // Set the global flag to true
        removeAllOverlays(); // Remove overlays globally
        playAllMedia(); // Automatically start playback in "Play All" mode
    } else if (mode === 'step') {
        detailsContainer.style.display = 'none';
        mediaStack.classList.remove('small-media');
        setTimeout(() => {
            selectStep(currentStepNumber);
        }, 0);
    } else if (mode === 'reference') {
        setTimeout(() => {
            selectStep(currentStepNumber);
        }, 0);
        mediaStack.classList.add('small-media');
        detailsContainer.style.display = 'block';
        loadDetails(currentStepNumber); // Load extra info for the current step
    }
    renderMedia(); // Update media stack for the selected mode
}

function loadDetails(stepNumber) {
    const detailsContainer = document.getElementById('detailsContainer');
    const stepData = contentData.steps[stepNumber - 1];

    if (stepData && stepData.details) {
        detailsContainer.innerHTML = `<strong>Details:</strong><p>${stepData.details}</p>`;
    } else {
        detailsContainer.innerHTML = `<p>No additional details available for this step.</p>`;
    }
}


function createStepElement(step, number) {
    const stepDiv = document.createElement('div');
    stepDiv.className = 'step';
    stepDiv.onclick = () => selectStep(number);

    stepDiv.innerHTML = `
        <div class="step-number">${number}.</div>
        <div>
            <strong>${step.title}</strong><br> ${step.shortDescription}
        </div>
    `;

    return stepDiv;
}

function createTipsElement() {
    const tipsDiv = document.createElement('div');
    tipsDiv.className = 'tips';

    const tipsList = contentData.globalTips[0].items
        .map(tip => `<li>${tip}</li>`)
        .join('');

    tipsDiv.innerHTML = `
        <strong>Quick Tips:</strong>
        <ul>${tipsList}</ul>
        Need help? ${contentData.support.contactMethods[0].value}
    `;

    return tipsDiv;
}

function prevStep() {
    const currentStep = document.querySelector('.step.active');
    if (!currentStep) return;
    const stepNumber = Array.from(document.querySelectorAll('.step')).indexOf(currentStep) + 1;
    const prevStepNumber = stepNumber === 1 ? contentData.steps.length : stepNumber - 1;
    selectStep(prevStepNumber);
}

function nextStep() {
    const currentStep = document.querySelector('.step.active');
    if (!currentStep) return;
    const stepNumber = Array.from(document.querySelectorAll('.step')).indexOf(currentStep) + 1;
    const nextStepNumber = stepNumber === contentData.steps.length ? 1 : stepNumber + 1;
    selectStep(nextStepNumber);
}

async function loadContent() {
    const response = await fetch(jsonUrl);
    contentData = await response.json();

    document.getElementById('pageTitle').textContent = contentData.title;
    document.getElementById('lastUpdated').textContent = `Last updated: ${contentData.lastUpdated}`;

    renderSteps();
    renderMedia();
    getTotalVideoDuration();
    document.getElementById('introduction').textContent = contentData.introduction;
    detailsContainer.style.display = 'none';

    selectStep(1);
}


function renderSteps() {
    const stepsContainer = document.getElementById('stepsContainer');
    stepsContainer.innerHTML = '';

    contentData.steps.forEach((step, index) => {
        const stepElement = createStepElement(step, index + 1);
        // Add hover event listeners
        stepElement.addEventListener('mouseenter', () => applyHoverEffect(index + 1));
        stepElement.addEventListener('mouseleave', () => removeHoverEffect(index + 1));
        stepsContainer.appendChild(stepElement);
    });

    stepsContainer.appendChild(createTipsElement());
}

function adjustStackMargin() {
    const mediaStack = document.querySelector('.media-stack');
    const itemCount = document.querySelectorAll('.media-item').length;


  
        // Base margin of 30px for 4 items or less
        // Additional 10px per item beyond 4 items
        const marginTop = itemCount <= 4 ? 30 : 30 + ((itemCount - 4) * 10);
        mediaStack.style.marginTop = `${marginTop}px`;
    
    
}

function renderMedia() {
    const mediaStack = document.getElementById('mediaStack');
    mediaStack.innerHTML = '';

    contentData.steps.forEach((step, index) => {
        let mediaElement;
        if (currentMode === 'step' || currentMode === 'auto') {
            // Use videos in step-by-step or auto mode
            mediaElement = createVideoElement(step, index + 1);
        } else if (currentMode === 'reference') {
            // Use images in reference mode
            mediaElement = createImageElement(step, index + 1);
        }

        if (mediaElement) {
            mediaStack.appendChild(mediaElement);
        }
    });

    adjustStackMargin();
}

function createImageElement(step, number) {
    const container = document.createElement('div');
    container.className = 'media-item';
    container.onclick = () => selectStep(number);

    const imageWrapper = document.createElement('div');
    imageWrapper.style.position = 'relative';
    imageWrapper.style.width = '100%';
    imageWrapper.style.height = '100%';

    const img = document.createElement('img');
    img.src = '${assetsUrl}${step.media.image}';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    img.draggable = false;

    imageWrapper.appendChild(img);
    container.appendChild(imageWrapper);

    if (step.media.hotspots) {
        img.onload = () => {
            const wrapperRect = imageWrapper.getBoundingClientRect();
            const imageAspectRatio = img.naturalWidth / img.naturalHeight;
            const wrapperAspectRatio = wrapperRect.width / wrapperRect.height;

            let renderedWidth, renderedHeight, leftOffset, topOffset;

            if (imageAspectRatio > wrapperAspectRatio) {
                renderedWidth = wrapperRect.width;
                renderedHeight = wrapperRect.width / imageAspectRatio;
                leftOffset = 0;
                topOffset = (wrapperRect.height - renderedHeight) / 2;
            } else {
                renderedHeight = wrapperRect.height;
                renderedWidth = wrapperRect.height * imageAspectRatio;
                topOffset = 0;
                leftOffset = (wrapperRect.width - renderedWidth) / 2;
            }

            step.media.hotspots.forEach(hotspot => {
                console.log('Creating hotspot');
                const hotspotElement = document.createElement('div');
                hotspotElement.className = 'hotspot';
                hotspotElement.style.position = 'absolute';

                const x = (hotspot.x / 100) * renderedWidth + leftOffset;
                const y = (hotspot.y / 100) * renderedHeight + topOffset;

                hotspotElement.style.left = `${x}px`;
                hotspotElement.style.top = `${y}px`;

                const tooltip = document.createElement('div');
                tooltip.className = 'hotspot-tooltip';
                tooltip.textContent = hotspot.title;
                hotspotElement.appendChild(tooltip);

                // Add the overlay (hidden by default)
                const overlay = document.createElement('div');
                overlay.className = 'hotspot-overlay';
                overlay.style.position = 'absolute';
                overlay.style.left = '0';
                overlay.style.top = '0';
                overlay.style.width = '100%';
                overlay.style.height = '100%';
                overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
                overlay.style.color = 'white';
                overlay.style.display = 'none';
                overlay.style.padding = '20px';
                overlay.style.boxSizing = 'border-box';
                overlay.style.zIndex = '1000';
                overlay.innerHTML = `
                    <strong>${hotspot.title}</strong>
                    <p>${hotspot.description}</p>
                `;

                // Add a document-wide click handler when showing the overlay
                hotspotElement.onclick = (e) => {
                    currentOverlay = true;
                    overlayElement = overlay;  // Store reference to the overlay
                    e.stopPropagation();
                    overlay.style.display = 'flex';
                };
                
                imageWrapper.appendChild(overlay);

                hotspotElement.addEventListener('mouseenter', () => {
                    const hotspotRect = hotspotElement.getBoundingClientRect();
                    const tooltipRect = tooltip.getBoundingClientRect();
                    const containerRect = imageWrapper.getBoundingClientRect();

                    tooltip.style.transform = 'translateX(-50%)';
                    tooltip.style.left = '50%';
                    tooltip.style.right = 'auto';
                    tooltip.style.top = '-30px';
                    tooltip.style.bottom = 'auto';

                    if (hotspotRect.left - (tooltipRect.width / 2) < containerRect.left) {
                        tooltip.style.transform = 'translateX(0)';
                        tooltip.style.left = '0';
                    } else if (hotspotRect.right + (tooltipRect.width / 2) > containerRect.right) {
                        tooltip.style.transform = 'translateX(-100%)';
                        tooltip.style.left = '100%';
                    }

                    if (hotspotRect.top - tooltipRect.height < containerRect.top) {
                        tooltip.style.top = 'auto';
                        tooltip.style.bottom = '-30px';
                    }
                });

                imageWrapper.appendChild(hotspotElement);
            });
        };
    }
    return container;
}

function showMaximizedView(imageSrc) {
    const overlay = document.createElement('div');
    overlay.className = 'maximize-overlay';
    overlay.onclick = () => overlay.remove();

    const img = document.createElement('img');
    img.src = imageSrc;
    img.className = 'maximized-image';

    overlay.appendChild(img);
    document.body.appendChild(overlay);
}

function createVideoElement(step, number) {
    // Create a container div for the video and overlay
    const container = document.createElement('div');
    container.className = 'media-item';
    container.onclick = () => selectStep(number);

    // Create the video element
    const video = document.createElement('video');
    video.src = '${assetsUrl}${step.media.video}';
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain';
    video.controls = true;
    video.muted = true; // Allow autoplay compatibility

    container.appendChild(video);

    const audio = document.createElement('audio');
    audio.src = `${assetsUrl}${step.media.audio}`;
    audio.style.display = 'none';
    container.appendChild(audio);

    video.onplay = () => audio.play();
    video.onpause = () => audio.pause();
    video.onended = () => audio.pause();

    video.onloadedmetadata = () => {
        audio.onloadedmetadata = () => {
            const videoDuration = video.duration;
            const audioDuration = audio.duration;

            if (audioDuration > videoDuration) {
                audio.playbackRate = videoDuration / audioDuration;
            } else if (videoDuration > audioDuration) {
                video.playbackRate = audioDuration / videoDuration;
            }
        };
    };

    // Add overlay only if it hasn't been clicked globally
    if (!overlayClicked) {
        const overlay = document.createElement('div');
        overlay.className = 'video-overlay';

        overlay.onclick = (e) => {
            e.stopPropagation();
            overlayClicked = true; // Set the global flag to true
            removeAllOverlays(); // Remove overlays globally
            video.play().catch(error => console.warn('Playback failed:', error));
        };

        const playIcon = document.createElement('div');
        playIcon.className = 'play-icon';
        playIcon.innerHTML = `
            <svg width="40" height="40" viewBox="0 0 24 24" fill="black" xmlns="http://www.w3.org/2000/svg">
                <polygon points="5,3 19,12 5,21" fill="black"/>
            </svg>
        `;

        overlay.appendChild(playIcon);
        container.appendChild(overlay);
    }

    return container;
}

// Function to remove all overlays
function removeAllOverlays() {
    const overlays = document.querySelectorAll('.video-overlay');
    overlays.forEach(overlay => overlay.remove());
}


function selectStep(stepNumber) {
    currentStepNumber = stepNumber
    const mediaItems = Array.from(document.querySelectorAll('.media-item'));

    

    // Rotate the stack so the selected item appears at the front
    const selectedItem = mediaItems[stepNumber - 1];
    const reorderedItems = mediaItems.slice(stepNumber - 1).concat(mediaItems.slice(0, stepNumber - 1));

    reorderedItems.forEach((item, index) => {
        item.style.zIndex = 100 - index;
        item.style.left = `${index * 30}px`;
        item.style.bottom = `${index * 7}px`;

        if (item === selectedItem) {
            item.classList.add('active');
            item.style.transform = 'scale(1)';
            item.style.zIndex = 100;

            // Play the selected video and reset its time to the beginning
            const video = item.querySelector('video');
            const audio = item.querySelector('audio');
            if (video && audio) {
                video.currentTime = 0;
                audio.currentTime = 0;
                if (overlayClicked) {
                    video.play().catch(error => console.warn('Playback prevented:', error));
                    audio.play().catch(error => console.warn('Audio playback prevented:', error));
                }
            }
        } else {
            item.classList.remove('active');
            // Pause any video that is not the selected one
            const video = item.querySelector('video');
            const audio = item.querySelector('audio');
            if (video && audio) {
                video.pause();
                audio.pause();
            }

        }
    });

    // Highlight the selected step in the step list
    document.querySelectorAll('.step').forEach((step, index) => {
        step.classList.toggle('active', index + 1 === stepNumber);
    });

    if (currentMode === 'reference') {
        loadDetails(stepNumber); // Load details if in "Image + Text" mode
    }
}


function playAllMedia() {
    if (currentMode !== 'auto') return;

    let currentStep = currentStepNumber;
    const mediaItems = Array.from(document.querySelectorAll('.media-item'))
        .map(item => item.querySelector('video')) // Get the video elements
        .filter(video => video); // Filter out nulls

    function playNext() {
        if (currentStep <= mediaItems.length) {
            selectStep(currentStep);
            const currentVideo = mediaItems[currentStep - 1];

            currentVideo.currentTime = 0;
            currentVideo.play().catch(error => {
                if (error.name === 'NotAllowedError') {
                    console.log("User interaction required for autoplay. Waiting for interaction.");
                } else {
                    console.error("Playback error:", error);
                }
            });

            currentVideo.onended = () => {
                currentStep++;
                playNext();
            };
        } else {
            console.log('All media has been played.');
        }
    }

    playNext();
}

function applyHoverEffect(stepNumber) {
    const mediaItems = Array.from(document.querySelectorAll('.media-item'));
    const targetItem = mediaItems[stepNumber - 1];

    if (targetItem) {
        targetItem.style.transform = 'translateY(-10px) scale(1.02)';
    }
}

function removeHoverEffect(stepNumber) {
    const mediaItems = Array.from(document.querySelectorAll('.media-item'));
    const targetItem = mediaItems[stepNumber - 1];

    if (targetItem) {
        targetItem.style.transform = ''; // Reset to default
    }
}

function getTotalVideoDuration() {
    const videoElements = document.querySelectorAll('.media-item video');
    let totalDuration = 0;

    const promises = Array.from(videoElements).map((video) => {
        return new Promise((resolve) => {
            video.addEventListener('loadedmetadata', () => {
                totalDuration += video.duration;
                resolve();
            });
        });
    });

    return Promise.all(promises).then(() => {
        const totalMinutes = Math.floor(totalDuration / 60);
        const totalSeconds = Math.floor(totalDuration % 60);
        const totalDurationText = `Last updated: ${contentData.lastUpdated} | Duration: ${totalMinutes}m ${totalSeconds}s`;

        document.getElementById('lastUpdated').textContent = totalDurationText;
    });
}


// Initialize content when page loads
document.addEventListener('DOMContentLoaded', loadContent);

document.addEventListener('click', (e) => {
    if (currentOverlay) {
        overlayElement.style.display = 'none';
        currentOverlay = false;
    }
});