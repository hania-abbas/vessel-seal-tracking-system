// frontend/validation.js


const RE_SEAL = /^[0-9]{6,9}$/;
const RE_VISIT = /^[A-Za-z0-9_-]{3,50}$/;

class ValidationHelper {
    constructor() {
        this.validationMessages = new Map();
        this.validators = new Map();
        this.initializeValidators();
    }

    initializeValidators() {
        // Seal number validation
        this.validators.set('seal', (value) => {
            if (!value) return { isValid: true };
            return RE_SEAL.test(value) ? 
                { isValid: true } : 
                { isValid: false, message: 'Seal number must be 6-9 digits' };
        });

        // Visit ID validation
        this.validators.set('visit', (value) => {
            if (!value) return { isValid: false, message: 'Visit ID is required' };
            return RE_VISIT.test(value) ?
                { isValid: true } :
                { isValid: false, message: 'Invalid visit ID format' };
        });

        // Supervisor validation
        this.validators.set('supervisor', (value) => {
            if (!value || value.trim().length < 2) {
                return { isValid: false, message: 'Supervisor name is required' };
            }
            if (value.length > 100) {
                return { isValid: false, message: 'Supervisor name too long' };
            }
            return { isValid: true };
        });

        // Notes validation
        this.validators.set('notes', (value) => {
            if (value && value.length > 2000) {
                return { isValid: false, message: 'Notes too long (max 2000 characters)' };
            }
            return { isValid: true };
        });
    }

    isSealNumber(value) {
        return RE_SEAL.test(String(value ?? '').trim());
    }

    validateSealRange(from, to) {
        if (!this.isSealNumber(from)) {
            return { isValid: false, message: 'Invalid "from" seal number' };
        }
        if (!this.isSealNumber(to)) {
            return { isValid: false, message: 'Invalid "to" seal number' };
        }
        if (Number(to) < Number(from)) {
            return { isValid: false, message: 'End seal must be ≥ start seal' };
        }
        return { isValid: true };
    }

    validateSingleSeal(seal) {
        if (!this.isSealNumber(seal)) {
            return { isValid: false, message: 'Invalid seal number format' };
        }
        return { isValid: true };
    }

    attachRealTimeValidation(inputId, validationFn, options = {}) {
        const input = document.getElementById(inputId);
        if (!input) return;

        // Create message element
        let messageEl = document.getElementById(`${inputId}-validation`);
        if (!messageEl) {
            messageEl = document.createElement('div');
            messageEl.id = `${inputId}-validation`;
            messageEl.className = 'validation-message';
            input.parentNode.appendChild(messageEl);
        }

        const validate = () => {
            const value = input.value.trim();
            const result = validationFn(value);
            this.validationMessages.set(inputId, result);
            this.updateValidationUI(input, messageEl, result);
            this.updateFormValidity();
        };

        // Initial validation
        validate();

        // Event listeners
        input.addEventListener('input', validate);
        input.addEventListener('blur', validate);
        input.addEventListener('change', validate);

        // Custom events for programmatic validation
        input.addEventListener('validate', validate);
    }

    updateValidationUI(input, messageEl, result) {
        if (!result.isValid) {
            input.classList.add('is-invalid');
            input.classList.remove('is-valid');
            messageEl.textContent = result.message;
            messageEl.className = 'validation-message error';
        } else {
            input.classList.remove('is-invalid');
            input.classList.add('is-valid');
            messageEl.textContent = '';
            messageEl.className = 'validation-message';
        }
    }

    updateFormValidity() {
        const forms = document.querySelectorAll('form');
        forms.forEach(form => {
            const submitButtons = form.querySelectorAll('button[type="submit"]');
            const isValid = this.isFormValid(form);
            
            submitButtons.forEach(button => {
                button.disabled = !isValid;
            });
        });
    }

    isFormValid(form) {
        const formInputs = Array.from(form.querySelectorAll('input, select, textarea'));
        return formInputs.every(input => {
            const validation = this.validationMessages.get(input.id);
            return !validation || validation.isValid;
        });
    }

    validateForm(formId) {
        const form = document.getElementById(formId);
        if (!form) return { isValid: false, errors: [] };

        const errors = [];
        const inputs = form.querySelectorAll('input, select, textarea');

        inputs.forEach(input => {
            const validation = this.validationMessages.get(input.id);
            if (validation && !validation.isValid) {
                errors.push({
                    field: input.id,
                    message: validation.message
                });
            }
        });

        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    setupFormValidation(formId) {
        const form = document.getElementById(formId);
        if (!form) return;

        // Common validations
        this.attachRealTimeValidation('vessel_supervisor', 
            value => this.validators.get('supervisor')(value));
        
        this.attachRealTimeValidation('return_vessel_supervisor', 
            value => this.validators.get('supervisor')(value));

        this.attachRealTimeValidation('delivered_notes', 
            value => this.validators.get('notes')(value));
        
        this.attachRealTimeValidation('return_notes', 
            value => this.validators.get('notes')(value));

        // Delivered form specific
        if (formId === 'sealForm') {
            this.attachRealTimeValidation('seal_from', 
                value => this.validateSealRange(value, document.getElementById('seal_to')?.value));
            
            this.attachRealTimeValidation('seal_to',
                value => this.validateSealRange(document.getElementById('seal_from')?.value, value));
            
            this.attachRealTimeValidation('single_seal',
                value => this.validateSingleSeal(value));
        }

        // Returned form specific
        if (formId === 'returnedSealForm') {
            this.attachRealTimeValidation('return_seal_from', 
                value => this.validateSealRange(value, document.getElementById('return_seal_to')?.value));
            
            this.attachRealTimeValidation('return_seal_to',
                value => this.validateSealRange(document.getElementById('return_seal_from')?.value, value));
            
            this.attachRealTimeValidation('return_single_seal',
                value => this.validateSingleSeal(value));
            
            this.attachRealTimeValidation('damaged_seal',
                value => value ? this.validateSingleSeal(value) : { isValid: true });
            
            this.attachRealTimeValidation('lost_seal',
                value => value ? this.validateSingleSeal(value) : { isValid: true });
        }
    }

    // Programmatic validation
    validateField(inputId, value) {
        const input = document.getElementById(inputId);
        if (!input) return { isValid: false, message: 'Field not found' };

        let validationFn;
        
        switch(inputId) {
            case 'seal_from':
            case 'return_seal_from':
                const toId = inputId.replace('_from', '_to');
                validationFn = () => this.validateSealRange(value, document.getElementById(toId)?.value);
                break;
            case 'seal_to':
            case 'return_seal_to':
                const fromId = inputId.replace('_to', '_from');
                validationFn = () => this.validateSealRange(document.getElementById(fromId)?.value, value);
                break;
            case 'single_seal':
            case 'return_single_seal':
            case 'damaged_seal':
            case 'lost_seal':
                validationFn = () => this.validateSingleSeal(value);
                break;
            default:
                if (this.validators.has(inputId)) {
                    validationFn = () => this.validators.get(inputId)(value);
                } else {
                    validationFn = () => ({ isValid: true });
                }
        }

        return validationFn();
    }
}

// Create singleton instance
const validationHelper = new ValidationHelper();

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Auto-setup forms with data-validation attribute
    document.querySelectorAll('form[data-validation="true"]').forEach(form => {
        validationHelper.setupFormValidation(form.id);
    });
});

window.validationHelper = validationHelper;
export default validationHelper;