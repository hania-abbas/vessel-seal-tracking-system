// frontend/submission-history.js


class SubmissionHistory {
    constructor() {
        this.history = [];
        this.maxHistory = 50; // Keep last 50 submissions
        this.loadFromStorage();
    }

    addSubmission(data) {
        const submission = {
            ...data,
            timestamp: new Date().toISOString(), // Fixed: toISOString() instead of toString()
            status: 'pending'
        };

        this.history.unshift(submission);
        if (this.history.length > this.maxHistory) {
            this.history.pop();
        }

        this.saveToStorage();
        this.updateUI();
        return submission;
    }

    updateSubmissionStatus(submission, status, response) {
        const index = this.history.findIndex(s => s === submission);
        if (index !== -1) {
            this.history[index] = {
                ...submission,
                status,
                response,
                completedAt: new Date().toISOString()
            };
            this.saveToStorage();
            this.updateUI();
        }
    }

    loadFromStorage() {
        try {
            const stored = localStorage.getItem('submissionHistory');
            if (stored) {
                this.history = JSON.parse(stored);
            }
        } catch (error) {
            console.error('Failed to load submission history:', error);
            this.history = [];
        }
    }

    saveToStorage() {
        try {
            localStorage.setItem('submissionHistory', JSON.stringify(this.history));
        } catch (error) {
            console.error('Failed to save submission history:', error);
        }
    }

    updateUI() {
        const historyContainer = document.getElementById('submissionHistory');
        if (!historyContainer) return;

        historyContainer.innerHTML = this.history.map(submission => `
            <div class="submission-entry ${submission.status}">
                <div class="submission-header">
                    <span class="submission-timestamp">${new Date(submission.timestamp).toLocaleString()}</span>
                    <span class="submission-status ${submission.status}">${submission.status}</span>
                </div>
                <div class="submission-details">
                    ${this.formatSubmissionDetails(submission)}
                </div>
                ${submission.response ? `
                    <div class="submission-response">
                        ${typeof submission.response === 'object' 
                            ? JSON.stringify(submission.response, null, 2)
                            : submission.response}
                    </div>
                ` : ''}
            </div>
        `).join('');
    }

    formatSubmissionDetails(submission) {
        const details = [];
        
        if (submission.delivered_from && submission.delivered_to) {
            details.push(`Delivered Range: ${submission.delivered_from} - ${submission.delivered_to}`);
        }
        
        if (submission.delivered_single) {
            details.push(`Delivered Single: ${submission.delivered_single}`);
        }
        
        if (submission.return_seal_from && submission.return_seal_to) {
            details.push(`Returned Range: ${submission.return_seal_from} - ${submission.return_seal_to}`);
        }
        
        if (submission.return_single_seal) {
            details.push(`Returned Single: ${submission.return_single_seal}`);
        }
        
        if (submission.damaged_seal) {
            details.push(`Damaged: ${submission.damaged_seal}`);
        }
        
        if (submission.lost_seal) {
            details.push(`Lost: ${submission.lost_seal}`);
        }

        if (submission.vessel_supervisor) {
            details.push(`Supervisor: ${submission.vessel_supervisor}`);
        }

        if (submission.delivered_notes) {
            details.push(`Notes: ${submission.delivered_notes}`);
        }

        if (submission.return_notes) {
            details.push(`Notes: ${submission.return_notes}`);
        }

        return details.join('<br>');
    }

    clearHistory() {
        this.history = [];
        this.saveToStorage();
        this.updateUI();
    }
}

// Create a singleton instance
const submissionHistory = new SubmissionHistory();
window.submissionHistory = submissionHistory;

