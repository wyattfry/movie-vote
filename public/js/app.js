// Movie Voting App Frontend JavaScript

document.addEventListener('DOMContentLoaded', function () {
    // Initialize the app
    initializeApp();
});

function initializeApp() {
    // Get DOM elements
    const suggestForm = document.getElementById('suggestForm');
    const moviesList = document.getElementById('moviesList');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const toastElement = document.getElementById('notificationToast');
    const toastMessage = document.getElementById('toastMessage');

    // Initialize Bootstrap toast
    const toast = new bootstrap.Toast(toastElement);

    // Event listeners
    if (suggestForm) {
        suggestForm.addEventListener('submit', handleMovieSuggestion);
    }

    // Delegate vote button clicks
    document.addEventListener('click', function (e) {
        if (e.target.closest('.vote-btn')) {
            handleVote(e.target.closest('.vote-btn'));
        } else if (e.target.closest('.remove-vote-btn')) {
            handleRemoveVote(e.target.closest('.remove-vote-btn'));
        } else if (e.target.closest('.delete-movie-btn')) {
            handleDeleteMovie(e.target.closest('.delete-movie-btn'));
        }
    });

    // Handle movie suggestion form
    async function handleMovieSuggestion(e) {
        e.preventDefault();

        const formData = new FormData(e.target);
        const movieData = {
            title: formData.get('title').trim(),
            description: formData.get('description').trim(),
            suggested_by: formData.get('suggested_by').trim()
        };

        if (!movieData.title || !movieData.suggested_by) {
            showToast('Please fill in all required fields.', 'error');
            return;
        }

        showLoading(true);

        try {
            // First search for movies to show confirmation
            const searchResponse = await fetch('/search-movie', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ title: movieData.title })
            });

            const searchResult = await searchResponse.json();

            if (searchResponse.ok && searchResult.success && searchResult.movies.length > 0) {
                // Show search results for user confirmation
                showMovieSearchResults(searchResult.movies, movieData);
            } else {
                // No results found, add the movie as entered
                showToast('No movies found in OMDB. Adding with your original title...', 'info');
                await addMovieDirectly(movieData);
            }
        } catch (error) {
            console.error('Error searching movie:', error);
            showToast('Search failed. Adding movie with original title...', 'info');
            await addMovieDirectly(movieData);
        } finally {
            showLoading(false);
        }
    }

    // Show movie search results in a modal for user confirmation
    function showMovieSearchResults(movies, originalData) {
        const modalHtml = `
            <div class="modal fade" id="movieSearchModal" tabindex="-1" data-bs-backdrop="static">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Select the correct movie</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <p class="mb-3">We found these movies matching "<strong>${originalData.title}</strong>". Please select the correct one:</p>
                            <div class="movie-options">
                                ${movies.map((movie, index) => `
                                    <div class="movie-option mb-3 p-3 border rounded" data-movie-index="${index}">
                                        <div class="row">
                                            <div class="col-auto">
                                                ${movie.poster ?
                `<img src="${movie.poster}" alt="${movie.title}" class="movie-poster-small" style="width: 60px; height: 90px; object-fit: cover;">` :
                '<div class="no-poster-small d-flex align-items-center justify-content-center" style="width: 60px; height: 90px; background-color: #f8f9fa; border: 1px solid #dee2e6;"><i class="fas fa-film text-muted"></i></div>'
            }
                                            </div>
                                            <div class="col">
                                                <h6 class="mb-1">${movie.title} <span class="text-muted">(${movie.year})</span></h6>
                                                ${movie.rating ? `<div class="text-warning mb-1"><i class="fas fa-star"></i> ${movie.rating}/10</div>` : ''}
                                                ${movie.genre ? `<div class="text-muted small mb-1">${movie.genre}</div>` : ''}
                                                ${movie.plot ? `<p class="small text-muted mb-1">${movie.plot.length > 150 ? movie.plot.substring(0, 150) + '...' : movie.plot}</p>` : ''}
                                                ${movie.director ? `<div class="small text-muted">Director: ${movie.director}</div>` : ''}
                                            </div>
                                            <div class="col-auto">
                                                <button class="btn btn-primary btn-sm select-movie-btn" data-movie-index="${index}">
                                                    Select This Movie
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                            <hr>
                            <div class="text-center">
                                <p class="text-muted">None of these match?</p>
                                <button class="btn btn-outline-secondary" id="useOriginalTitle">
                                    Use original title: "${originalData.title}"
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if any
        const existingModal = document.getElementById('movieSearchModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Add modal to DOM
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = new bootstrap.Modal(document.getElementById('movieSearchModal'));
        modal.show();

        // Handle movie selection
        document.querySelectorAll('.select-movie-btn').forEach(btn => {
            btn.addEventListener('click', async function () {
                const movieIndex = parseInt(this.getAttribute('data-movie-index'));
                const selectedMovie = movies[movieIndex];

                modal.hide();
                showLoading(true);

                // Add movie with OMDB data
                const movieWithOmdbData = {
                    title: selectedMovie.title,
                    description: originalData.description || selectedMovie.plot,
                    suggested_by: originalData.suggested_by
                };

                await addMovieDirectly(movieWithOmdbData);
                showLoading(false);
            });
        });

        // Handle "use original title" button
        document.getElementById('useOriginalTitle').addEventListener('click', async function () {
            modal.hide();
            showLoading(true);
            await addMovieDirectly(originalData);
            showLoading(false);
        });
    }

    // Add movie directly to the database
    async function addMovieDirectly(movieData) {
        try {
            const response = await fetch('/suggest', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(movieData)
            });

            const result = await response.json();

            if (response.ok && result.success) {
                showToast(`"${movieData.title}" has been added to the list!`, 'success');
                document.getElementById('suggestForm').reset();
                clearFormData();
                // Refresh the page to show the new movie
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                showToast(result.error || 'Failed to add movie suggestion.', 'error');
            }
        } catch (error) {
            console.error('Error suggesting movie:', error);
            showToast('Network error. Please try again.', 'error');
        }
    }

    // Handle voting
    async function handleVote(button) {
        const movieId = button.getAttribute('data-movie-id');

        if (!movieId) return;

        // Add visual feedback
        button.classList.add('voting');
        button.disabled = true;

        try {
            const response = await fetch(`/vote/${movieId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            const result = await response.json();

            if (response.ok && result.success) {
                showToast('Vote added!', 'success');
                // Update the button state
                updateVoteButton(button, true);
                // Increment vote count
                incrementVoteCount(button);
            } else {
                showToast(result.error || 'Failed to add vote.', 'error');
            }
        } catch (error) {
            console.error('Error voting:', error);
            showToast('Network error. Please try again.', 'error');
        } finally {
            button.classList.remove('voting');
            button.disabled = false;
        }
    }

    // Handle removing vote
    async function handleRemoveVote(button) {
        const movieId = button.getAttribute('data-movie-id');

        if (!movieId) return;

        button.disabled = true;

        try {
            const response = await fetch(`/vote/${movieId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            const result = await response.json();

            if (response.ok && result.success) {
                showToast('Vote removed!', 'info');
                // Update the button state
                updateVoteButton(button, false);
                // Decrement vote count
                decrementVoteCount(button);
            } else {
                showToast(result.error || 'Failed to remove vote.', 'error');
            }
        } catch (error) {
            console.error('Error removing vote:', error);
            showToast('Network error. Please try again.', 'error');
        } finally {
            button.disabled = false;
        }
    }

    // Handle deleting movie
    async function handleDeleteMovie(button) {
        const movieId = button.getAttribute('data-movie-id');

        if (!movieId) return;

        // Show confirmation dialog
        if (!confirm('Are you sure you want to delete this movie suggestion? This action cannot be undone.')) {
            return;
        }

        button.disabled = true;
        const originalText = button.innerHTML;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        try {
            const response = await fetch(`/movie/${movieId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            const result = await response.json();

            if (response.ok && result.success) {
                showToast('Movie deleted successfully!', 'success');
                // Remove the movie card from the DOM - target the outer container div
                const movieCard = button.closest('.col-md-6');
                if (movieCard) {
                    movieCard.style.transition = 'opacity 0.3s ease-out';
                    movieCard.style.opacity = '0';
                    setTimeout(() => {
                        movieCard.remove();
                        updateMovieCount();
                    }, 300);
                }
            } else {
                showToast(result.error || 'Failed to delete movie.', 'error');
                button.innerHTML = originalText;
                button.disabled = false;
            }
        } catch (error) {
            console.error('Error deleting movie:', error);
            showToast('Network error. Please try again.', 'error');
            button.innerHTML = originalText;
            button.disabled = false;
        }
    }

    // Update movie count in header
    function updateMovieCount() {
        const movieCards = document.querySelectorAll('[data-movie-id]');
        const movieCountElement = document.getElementById('movieCount');
        if (movieCountElement) {
            const count = movieCards.length;
            movieCountElement.textContent = `${count} movie${count !== 1 ? 's' : ''}`;
        }
    }

    // Update vote button state
    function updateVoteButton(button, voted) {
        const icon = button.querySelector('i');

        if (voted) {
            // Change to remove vote button
            button.className = 'btn btn-outline-danger btn-sm remove-vote-btn';
            icon.className = 'fas fa-heart';
        } else {
            // Change to vote button
            button.className = 'btn btn-outline-primary btn-sm vote-btn';
            icon.className = 'far fa-heart';
        }
    }

    // Increment vote count
    function incrementVoteCount(button) {
        const voteText = button.childNodes[1]; // Text node after icon
        if (voteText && voteText.nodeType === Node.TEXT_NODE) {
            const currentCount = parseInt(voteText.textContent.trim()) || 0;
            voteText.textContent = ` ${currentCount + 1}`;
        }
    }

    // Decrement vote count
    function decrementVoteCount(button) {
        const voteText = button.childNodes[1]; // Text node after icon
        if (voteText && voteText.nodeType === Node.TEXT_NODE) {
            const currentCount = parseInt(voteText.textContent.trim()) || 0;
            voteText.textContent = ` ${Math.max(0, currentCount - 1)}`;
        }
    }

    // Show loading overlay
    function showLoading(show) {
        if (show) {
            loadingOverlay.classList.add('show');
        } else {
            loadingOverlay.classList.remove('show');
        }
    }

    // Show toast notification
    function showToast(message, type = 'info') {
        // Remove existing type classes
        toastElement.classList.remove('toast-success', 'toast-error', 'toast-info');

        // Add new type class
        if (type) {
            toastElement.classList.add(`toast-${type}`);
        }

        // Set message
        toastMessage.textContent = message;

        // Show toast
        toast.show();
    }

    // Auto-save form data in localStorage to prevent data loss
    function saveFormData() {
        const title = document.getElementById('title').value;
        const description = document.getElementById('description').value;
        const suggestedBy = document.getElementById('suggested_by').value;

        localStorage.setItem('movieForm', JSON.stringify({
            title,
            description,
            suggested_by: suggestedBy
        }));
    }

    // Restore form data from localStorage
    function restoreFormData() {
        try {
            const savedData = localStorage.getItem('movieForm');
            if (savedData) {
                const data = JSON.parse(savedData);
                document.getElementById('title').value = data.title || '';
                document.getElementById('description').value = data.description || '';
                document.getElementById('suggested_by').value = data.suggested_by || '';
            }
        } catch (e) {
            console.log('Could not restore form data:', e);
        }
    }

    // Clear saved form data
    function clearFormData() {
        localStorage.removeItem('movieForm');
    }

    // Save form data on input
    ['title', 'description', 'suggested_by'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('input', saveFormData);
        }
    });

    // Restore form data on load
    restoreFormData();

    // Clear form data when form is successfully submitted
    suggestForm.addEventListener('submit', function (e) {
        // Clear saved data after a short delay to allow for error handling
        setTimeout(() => {
            if (document.getElementById('title').value === '') {
                clearFormData();
            }
        }, 2000);
    });

    // Add keyboard shortcuts
    document.addEventListener('keydown', function (e) {
        // Ctrl/Cmd + Enter to submit form
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            const activeElement = document.activeElement;
            if (activeElement && (
                activeElement.id === 'title' ||
                activeElement.id === 'description' ||
                activeElement.id === 'suggested_by'
            )) {
                e.preventDefault();
                suggestForm.dispatchEvent(new Event('submit'));
            }
        }
    });

    // Add visual feedback for form validation
    function setupFormValidation() {
        const requiredFields = document.querySelectorAll('[required]');

        requiredFields.forEach(field => {
            field.addEventListener('blur', function () {
                if (!this.value.trim()) {
                    this.classList.add('is-invalid');
                } else {
                    this.classList.remove('is-invalid');
                    this.classList.add('is-valid');
                }
            });

            field.addEventListener('input', function () {
                if (this.classList.contains('is-invalid') && this.value.trim()) {
                    this.classList.remove('is-invalid');
                    this.classList.add('is-valid');
                }
            });
        });
    }

    setupFormValidation();

    // Add tooltips for better UX
    function initializeTooltips() {
        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });
    }

    initializeTooltips();

    // Performance: Debounce rapid clicks
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Apply debouncing to vote buttons
    const debouncedVote = debounce(handleVote, 300);
    const debouncedRemoveVote = debounce(handleRemoveVote, 300);

    console.log('Movie Voting App initialized successfully! 🎬');
}
