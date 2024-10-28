#!/bin/bash

# Run the gas report command and filter lines that start with optional spaces followed by '|' or '·'
filtered_output=$(yarn workspace @perennial/core run gasReport | grep -E '^\s*(\||·)' | sed -r 's/\x1B\[[0-9;]*[mK]//g')

# Function to extract the gas report
extract_gas_report() {
    echo "$filtered_output" | awk '
    /·--/ { 
        table_count++           # Increment table count at each boundary
        if (table_count == 4) {  # Start capturing when reaching the third table
            capturing = 1
        }
        next
    }
    capturing { print }         # Print only lines within the third table
    '
}

# Capture the gas report table output
gas_report_output=$(extract_gas_report)

# Write the gas report table output to a file
echo "$gas_report_output" > gas_report.txt
