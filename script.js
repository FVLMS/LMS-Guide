function selectStep(stepNumber) {
    const screenshots = Array.from(document.querySelectorAll('.screenshot'));
    const selectedScreenshot = screenshots[stepNumber - 1];
    const newStackOrder = screenshots.slice(stepNumber - 1).concat(screenshots.slice(0, stepNumber - 1));

    newStackOrder.forEach((img, index) => {
        img.style.zIndex = screenshots.length - index;

        // Adjusted positioning for new image size and spacing
        img.style.left = `${index * 20}px`; // Reduced offset for tighter arrangement
        img.style.bottom = `${index * 20}px`; // Reduced offset for tighter arrangement

        img.classList.toggle('active', img === selectedScreenshot);
    });

    document.querySelectorAll('.step').forEach((step, index) => {
        step.classList.toggle('active', index + 1 === stepNumber);
    });
}

function highlightImage(stepNumber) {
    const screenshots = document.querySelectorAll('.screenshot');
    screenshots.forEach((img, index) => {
        if (index === stepNumber - 1) {
            img.style.transform = 'translateY(-10px)'; // Only translate upwards, no z-index change
        }
    });
}

function unhighlightImage(stepNumber) {
    const screenshots = document.querySelectorAll('.screenshot');
    screenshots.forEach((img, index) => {
        if (index === stepNumber - 1) {
            img.style.transform = ''; // Reset the translation, no z-index change needed
        }
    });
}

function nextStep() {
    const currentStep = document.querySelector('.step.active');
    const stepNumber = Array.from(document.querySelectorAll('.step')).indexOf(currentStep) + 1;
    const nextStepNumber = stepNumber === 4 ? 1 : stepNumber + 1;
    selectStep(nextStepNumber);
}

function prevStep() {
    const currentStep = document.querySelector('.step.active');
    const stepNumber = Array.from(document.querySelectorAll('.step')).indexOf(currentStep) + 1;
    const prevStepNumber = stepNumber === 1 ? 4 : stepNumber - 1;
    selectStep(prevStepNumber);
}

function playAllVideos() {
    const videos = Array.from(document.querySelectorAll('video.screenshot'));
    let currentIndex = 0;

    function playNextVideo() {
        if (currentIndex < videos.length) {
            const video = videos[currentIndex];
            selectStep(currentIndex + 1); // Highlight the current step
            video.play();
            video.onended = () => {
                currentIndex++;
                playNextVideo();
            };
        }
    }

    playNextVideo(); // Start playing the first video
}
