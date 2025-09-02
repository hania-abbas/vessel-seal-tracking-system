// frontend/test-data.js

const testData = {
    // Valid test cases
    valid: {
        singleSeal: {
            return_single_seal: "123456",
            vessel_supervisor: "John Doe",
            return_notes: "Regular return - single seal"
        },
        sealRange: {
            return_seal_from: "100000",
            return_seal_to: "100010",
            vessel_supervisor: "Jane Smith",
            return_notes: "Regular return - seal range"
        },
        damagedSeal: {
            return_single_seal: "234567",
            damaged: true,
            damaged_seal: "234567",
            vessel_supervisor: "Mike Johnson",
            return_notes: "Damaged seal return"
        },
        lostSeal: {
            return_single_seal: "345678",
            lost: true,
            lost_seal: "345678",
            vessel_supervisor: "Sarah Wilson",
            return_notes: "Lost seal report"
        },
        mixedCase: {
            return_seal_from: "400000",
            return_seal_to: "400005",
            return_single_seal: "400006",
            damaged: true,
            damaged_seal: "400003",
            lost: true,
            lost_seal: "400005",
            vessel_supervisor: "Robert Brown",
            return_notes: "Mixed case - range, single, damaged, and lost"
        }
    },

    // Invalid test cases
    invalid: {
        invalidSealFormat: {
            return_single_seal: "12345", // too short
            vessel_supervisor: "John Doe",
            return_notes: "Invalid seal number format"
        },
        invalidRange: {
            return_seal_from: "200010",
            return_seal_to: "200000", // less than from
            vessel_supervisor: "Jane Smith",
            return_notes: "Invalid range - end less than start"
        },
        missingRequired: {
            return_single_seal: "123456",
            // missing vessel_supervisor
            return_notes: "Missing required field"
        },
        invalidDamagedSeal: {
            return_single_seal: "234567",
            damaged: true,
            damaged_seal: "23456", // invalid format
            vessel_supervisor: "Mike Johnson",
            return_notes: "Invalid damaged seal format"
        },
        overlappingRange: {
            return_seal_from: "300000",
            return_seal_to: "300010",
            return_single_seal: "300005", // within range
            vessel_supervisor: "Sarah Wilson",
            return_notes: "Overlapping range and single seal"
        }
    },

    // Edge cases
    edge: {
        minimumLength: {
            return_single_seal: "100000", // minimum 6 digits
            vessel_supervisor: "John Doe",
            return_notes: "Minimum length seal number"
        },
        maximumLength: {
            return_single_seal: "999999999", // maximum 9 digits
            vessel_supervisor: "Jane Smith",
            return_notes: "Maximum length seal number"
        },
        sameFromTo: {
            return_seal_from: "444444",
            return_seal_to: "444444",
            vessel_supervisor: "Mike Johnson",
            return_notes: "Same from and to numbers"
        },
        longNotes: {
            return_single_seal: "555555",
            vessel_supervisor: "Sarah Wilson",
            return_notes: "A".repeat(500) // Very long notes
        },
        specialCharacters: {
            return_single_seal: "666666",
            vessel_supervisor: "Robert Brown",
            return_notes: "Special chars: !@#$%^&*()"
        }
    }
};

// Function to populate form with test data
function populateTestForm(formId, data) {
    const form = document.getElementById(formId);
    if (!form) return;

    // Clear existing form data
    form.reset();

    // Populate form fields
    Object.entries(data).forEach(([key, value]) => {
        const input = form.querySelector(`[name="${key}"]`);
        if (!input) return;

        if (input.type === 'checkbox') {
            input.checked = value;
        } else {
            input.value = value;
        }
    });
}

// Function to run test cases
async function runTestCases(formId) {
    const results = {
        passed: [],
        failed: []
    };

    // Test valid cases
    console.log('Running valid test cases...');
    for (const [name, data] of Object.entries(testData.valid)) {
        try {
            console.log(`Testing: ${name}`);
            populateTestForm(formId, data);
            // Trigger form submission here
            // You'll need to modify this based on your actual submission logic
            results.passed.push(name);
        } catch (error) {
            console.error(`Test failed for ${name}:`, error);
            results.failed.push({ name, error: error.message });
        }
    }

    // Test invalid cases
    console.log('Running invalid test cases...');
    for (const [name, data] of Object.entries(testData.invalid)) {
        try {
            console.log(`Testing: ${name}`);
            populateTestForm(formId, data);
            // These should fail validation
        } catch (error) {
            // Expected to fail
            results.passed.push(name);
        }
    }

    // Test edge cases
    console.log('Running edge test cases...');
    for (const [name, data] of Object.entries(testData.edge)) {
        try {
            console.log(`Testing: ${name}`);
            populateTestForm(formId, data);
            // Some of these might pass, some might fail
        } catch (error) {
            console.warn(`Edge case ${name} resulted in:`, error);
        }
    }

    return results;
}

// Export functions and data
window.testData = testData;
window.populateTestForm = populateTestForm;
window.runTestCases = runTestCases;

export { testData, populateTestForm, runTestCases };
