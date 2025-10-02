// frontend/submission-state.js


class SubmissionState {
    constructor() {
        this.isSubmitting = false;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 second initial delay
        this.listeners = new Set();
        this.queue = [];
        this.processing = false;
    }

    setSubmitting(isSubmitting, context = {}) {
        this.isSubmitting = isSubmitting;
        
        if (!isSubmitting) {
            this.retryCount = 0; // Reset retry count when submission completes
        }
        
        this.notifyListeners({ isSubmitting, ...context });
        this.updateUI(context);
        
        // Process queue when not submitting
        if (!isSubmitting && this.queue.length > 0) {
            this.processQueue();
        }
    }

    addListener(callback) {
        this.listeners.add(callback);
        // Immediately notify new listener of current state
        callback(this.isSubmitting);
    }

    removeListener(callback) {
        this.listeners.delete(callback);
    }

    notifyListeners(state) {
        this.listeners.forEach(callback => callback(state));
    }

    updateUI(context = {}) {
        // Update all submit buttons
        const submitButtons = document.querySelectorAll('button[type="submit"]');
        submitButtons.forEach(button => {
            this.updateButtonState(button, context);
        });

        // Update loading indicators
        this.updateLoadingIndicators(context);

        // Update form states
        this.updateFormStates(context);
    }

    updateButtonState(button, context) {
        if (this.isSubmitting) {
            button.disabled = true;
            const originalText = button.textContent;
            button.dataset.originalText = originalText;
            
            if (context.operation) {
                button.innerHTML = `
                    <span class="spinner"></span>
                    ${context.operation}...
                    ${this.retryCount > 0 ? `<span class="retry-indicator">(Retry ${this.retryCount}/${this.maxRetries})</span>` : ''}
                `;
            } else {
                button.innerHTML = '<span class="spinner"></span> Processing...';
            }
        } else {
            button.disabled = false;
            if (button.dataset.originalText) {
                button.textContent = button.dataset.originalText;
                delete button.dataset.originalText;
            }
        }
    }

    updateLoadingIndicators(context) {
        const loadingIndicator = document.getElementById('submissionStatus');
        if (loadingIndicator) {
            if (this.isSubmitting) {
                loadingIndicator.style.display = 'block';
                loadingIndicator.innerHTML = `
                    <div class="loading-content">
                        <span class="spinner"></span>
                        <span>${context.operation || 'Processing'}...</span>
                        ${this.retryCount > 0 ? 
                            `<div class="retry-info">Retry attempt ${this.retryCount} of ${this.maxRetries}</div>` : ''}
                    </div>
                `;
            } else {
                loadingIndicator.style.display = 'none';
                loadingIndicator.innerHTML = '';
            }
        }
    }

    updateFormStates(context) {
        const forms = document.querySelectorAll('form');
        forms.forEach(form => {
            if (this.isSubmitting) {
                form.classList.add('submitting');
            } else {
                form.classList.remove('submitting');
            }
        });
    }

    async withRetry(operation, options = {}) {
        const {
            maxRetries = this.maxRetries,
            retryDelay = this.retryDelay,
            operationName = 'Operation',
            onRetry = null
        } = options;

        this.retryCount = 0;
        
        while (this.retryCount < maxRetries) {
            try {
                this.setSubmitting(true, { 
                    operation: operationName,
                    retryCount: this.retryCount 
                });
                
                const result = await operation();
                
                this.setSubmitting(false, { 
                    operation: operationName,
                    success: true 
                });
                
                return result;
                
            } catch (error) {
                this.retryCount++;
                
                if (onRetry) {
                    onRetry(this.retryCount, maxRetries, error);
                }
                
                if (this.retryCount >= maxRetries) {
                    this.setSubmitting(false, { 
                        operation: operationName,
                        success: false,
                        error: error.message 
                    });
                    throw error;
                }
                
                console.warn(`Retry attempt ${this.retryCount}/${maxRetries}`, error);
                
                // Exponential backoff with jitter
                const delay = retryDelay * Math.pow(2, this.retryCount - 1);
                const jitter = delay * 0.1 * Math.random();
                const totalDelay = delay + jitter;
                
                await new Promise(resolve => setTimeout(resolve, totalDelay));
            }
        }
    }

    // Queue system for multiple submissions
    async enqueue(operation, priority = 0) {
        return new Promise((resolve, reject) => {
            this.queue.push({ operation, priority, resolve, reject });
            this.queue.sort((a, b) => b.priority - a.priority); // Higher priority first
            
            if (!this.processing) {
                this.processQueue();
            }
        });
    }

    async processQueue() {
        if (this.processing || this.queue.length === 0) return;
        
        this.processing = true;
        
        while (this.queue.length > 0) {
            const { operation, resolve, reject } = this.queue.shift();
            
            try {
                const result = await this.withRetry(operation);
                resolve(result);
            } catch (error) {
                reject(error);
            }
        }
        
        this.processing = false;
    }

    clearQueue() {
        this.queue = [];
        this.processing = false;
    }

    getQueueLength() {
        return this.queue.length;
    }

    // Status methods
    getStatus() {
        return {
            isSubmitting: this.isSubmitting,
            retryCount: this.retryCount,
            maxRetries: this.maxRetries,
            queueLength: this.queue.length,
            processing: this.processing
        };
    }

    // Reset everything
    reset() {
        this.isSubmitting = false;
        this.retryCount = 0;
        this.queue = [];
        this.processing = false;
        this.notifyListeners({ isSubmitting: false, reset: true });
        this.updateUI({ reset: true });
    }
}

// Create a singleton instance
const submissionState = new SubmissionState();

// Export the singleton
window.submissionState = submissionState;
export default submissionState;