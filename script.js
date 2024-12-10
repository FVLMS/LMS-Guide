let contentData = null;
let currentMode = 'step'; // Default mode
let overlayClicked = false; // Track if overlay has been clicked globally
let currentStepNumber = 1; // Track the current step globally
let currentOverlay = false;
let overlayElement = null;  // Add this to track the overlay element
const baseUrl = 'https://mnfhs.sharepoint.com/sites/LMSTeam/LMS Public/CornerstoneTraining/';
const urlParams = new URLSearchParams(window.location.search);
const title = urlParams.get('title');
const jsonUrl = `content/${title}.json`;
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
    `;
    // Need help? ${contentData.support.contactMethods[0].value}

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
    // document.getElementById('introduction').textContent = contentData.introduction;
    detailsContainer.style.display = 'none';

    selectStep(1);
}


function renderSteps() {
    const stepsContainer = document.getElementById('stepsContainer');
    //stepsContainer.innerHTML = '';

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
    img.src = `${assetsUrl}${step.media.image}`;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    img.draggable = false;

    imageWrapper.appendChild(img);
    container.appendChild(imageWrapper);

    if (step.media.hotspots) {
        const updateHotspotPositions = () => {
            const imgRect = img.getBoundingClientRect();
            const wrapperRect = imageWrapper.getBoundingClientRect();
            
            const scale = img.naturalWidth / imgRect.width;
            const actualWidth = imgRect.width;
            const actualHeight = imgRect.height;
            
            const leftOffset = (wrapperRect.width - actualWidth) / 2;
            const topOffset = (wrapperRect.height - actualHeight) / 2;
            
            imageWrapper.querySelectorAll('.hotspot, .hotspot-overlay').forEach(el => el.remove());
            
            step.media.hotspots.forEach(hotspot => {
                const hotspotElement = document.createElement('div');
                hotspotElement.className = 'hotspot';
                
                const x = (hotspot.x / 100) * actualWidth + leftOffset;
                const y = (hotspot.y / 100) * actualHeight + topOffset;
                
                hotspotElement.style.left = `${x}px`;
                hotspotElement.style.top = `${y}px`;
                
                const tooltip = document.createElement('div');
                tooltip.className = 'hotspot-tooltip';
                tooltip.textContent = hotspot.title;
                hotspotElement.appendChild(tooltip);
                
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
                overlay.style.zIndex = '1000';
                overlay.innerHTML = `
                    <strong>${hotspot.title}</strong>
                    <p>${hotspot.description}</p>
                `;
                
                hotspotElement.onclick = (e) => {
                    e.stopPropagation();
                    currentOverlay = true;
                    overlayElement = overlay;
                    overlay.style.display = 'flex';
                    overlay.style.flexDirection = 'column';
                    overlay.style.justifyContent = 'center';
                    overlay.style.alignItems = 'center';
                    overlay.style.padding = '20px';
                    overlay.style.textAlign = 'center';
                };
                
                imageWrapper.appendChild(overlay);
                imageWrapper.appendChild(hotspotElement);
            });
        };

        img.onload = updateHotspotPositions;
        new ResizeObserver(updateHotspotPositions).observe(imageWrapper);
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
    const container = document.createElement('div');
    container.className = 'media-item';
    container.onclick = () => selectStep(number);

    const video = document.createElement('video');
    video.src = `${assetsUrl}${contentData.mainVideo}`;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain';
    video.controls = true;
    video.muted = false; // Don't mute by default

    // Add timeupdate listener for step-by-step mode
    video.addEventListener('timeupdate', () => {
        if (currentMode === 'step' && video.currentTime >= step.media.timestamp.end) {
            video.pause();
            video.currentTime = step.media.timestamp.end;
        }
    });

    if (step.media.timestamp) {
        video.currentTime = step.media.timestamp.start;
    }

    container.appendChild(video);

    // Add overlay if not clicked
    if (!overlayClicked) {
        const overlay = document.createElement('div');
        overlay.className = 'video-overlay';

        overlay.onclick = (e) => {
            e.stopPropagation();
            overlayClicked = true;
            removeAllOverlays();
            video.muted = true; // Temporarily mute for autoplay
            video.play().then(() => {
                video.muted = false; // Unmute after autoplay starts
            }).catch(error => console.warn('Playback failed:', error));
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
    currentStepNumber = stepNumber;
    const mediaItems = Array.from(document.querySelectorAll('.media-item'));
    const stepData = contentData.steps[stepNumber - 1];

    const selectedItem = mediaItems[stepNumber - 1];
    const reorderedItems = mediaItems.slice(stepNumber - 1).concat(mediaItems.slice(0, stepNumber - 1));

    reorderedItems.forEach((item, index) => {
        item.style.zIndex = 100 - index;
        item.style.left = `${index * 30}px`;
        item.style.bottom = `${index * 7}px`;

        const video = item.querySelector('video');

        if (item === selectedItem) {
            item.classList.add('active');
            item.style.transform = 'scale(1)';
            item.style.zIndex = 100;

            if (video && stepData.media.timestamp) {
                video.currentTime = stepData.media.timestamp.start;

                if (overlayClicked) {
                    if (currentMode === 'auto') {
                        video.play().then(() => {
                            const timeCheckHandler = () => {
                                if (video.currentTime >= stepData.media.timestamp.end) {
                                    video.pause();
                                    video.removeEventListener('timeupdate', timeCheckHandler);
                                    const nextStepNumber = stepNumber === contentData.steps.length ? 1 : stepNumber + 1;
                                    selectStep(nextStepNumber);
                                }
                            };
                            video.addEventListener('timeupdate', timeCheckHandler);
                        }).catch(error => console.warn('Playback prevented:', error));
                    } else if (currentMode === 'step') {
                        // In step mode, start playing but stop at end timestamp
                        video.play().then(() => {
                            video.addEventListener('timeupdate', () => {
                                if (video.currentTime >= stepData.media.timestamp.end) {
                                    video.pause();
                                    video.currentTime = stepData.media.timestamp.end;
                                }
                            });
                        }).catch(error => console.warn('Playback prevented:', error));
                    }
                }
            }
        } else {
            item.classList.remove('active');
            if (video) {
                video.pause();
            }
        }
    });

    document.querySelectorAll('.step').forEach((step, index) => {
        step.classList.toggle('active', index + 1 === stepNumber);
    });

    if (currentMode === 'reference') {
        loadDetails(stepNumber);
    }
}


function playAllMedia() {
    if (currentMode !== 'auto') return;

    let currentStep = currentStepNumber;
    const mediaItems = Array.from(document.querySelectorAll('.media-item'))
        .map(item => ({
            video: item.querySelector('video'),
            stepData: contentData.steps[currentStep - 1]
        }))
        .filter(media => media.video);

    function playNext() {
        if (currentStep <= mediaItems.length) {
            selectStep(currentStep);
            const currentMedia = mediaItems[currentStep - 1];

            if (currentMedia.stepData.media.timestamp) {
                currentMedia.video.currentTime = currentMedia.stepData.media.timestamp.start;
                currentMedia.video.muted = true; // Temporarily mute for autoplay

                currentMedia.video.play().then(() => {
                    currentMedia.video.muted = false; // Unmute after playback starts
                }).catch(error => {
                    if (error.name === 'NotAllowedError') {
                        console.log("User interaction required for autoplay. Waiting for interaction.");
                        const interactionOverlay = document.createElement('div');
                        interactionOverlay.className = 'video-overlay';
                        interactionOverlay.innerHTML = '<div class="play-icon">Click to start playback</div>';
                        interactionOverlay.onclick = (e) => {
                            e.stopPropagation();
                            interactionOverlay.remove();
                            playNext();
                        };
                        currentMedia.video.parentElement.appendChild(interactionOverlay);
                    }
                });

                const timeCheckHandler = () => {
                    if (currentMedia.video.currentTime >= currentMedia.stepData.media.timestamp.end) {
                        currentMedia.video.pause();
                        currentMedia.video.removeEventListener('timeupdate', timeCheckHandler);
                        currentStep++;
                        playNext();
                    }
                };
                currentMedia.video.addEventListener('timeupdate', timeCheckHandler);
            }
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
    // Only need to check one video since it's the same source
    const video = document.querySelector('.media-item video');
    if (!video) return;

    return new Promise((resolve) => {
        video.addEventListener('loadedmetadata', () => {
            const totalDuration = video.duration;
            const totalMinutes = Math.floor(totalDuration / 60);
            const totalSeconds = Math.floor(totalDuration % 60);
            const totalDurationText = `Last updated: ${contentData.lastUpdated} | Duration: ${totalMinutes}m ${totalSeconds}s`;

            document.getElementById('lastUpdated').textContent = totalDurationText;
            resolve();
        });
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