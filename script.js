function showImage(stepNumber) {
    // Update active step
    document.querySelectorAll('.step').forEach((step, index) => {
        step.classList.toggle('active', index + 1 === stepNumber);
    });
}

function highlightImage(stepNumber) {
    const screenshots = Array.from(document.querySelectorAll('.screenshot'));
    screenshots[0].classList.remove('hover');
    screenshots[1].classList.remove('hover');
    screenshots[stepNumber - 1].classList.add('hover');
}

function unhighlightImage(stepNumber) {
    const screenshots = document.querySelectorAll('.screenshot');
    screenshots[stepNumber - 1].classList.remove('hover');
}