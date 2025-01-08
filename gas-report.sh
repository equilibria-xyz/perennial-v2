#!/bin/bash

# Run the gas report command and filter lines that start with optional spaces followed by '|' or '·'
filtered_output=$(yarn workspace @perennial/v2-core run gasReport | grep -E '^\s*(\||·)' | sed -r 's/\x1B\[[0-9;]*[mK]//g')

# Insert a blank line between the two tables
processed_output=$(echo "$filtered_output" | awk '
    /·--/ {
        if (in_table == 2) {
            print ""  # Insert blank line once between the two tables
        }
        in_table = in_table + 1
    }
    {
        print
    }
')

# Function to extract Code Size table
extract_code_size() {
    echo "$processed_output" | awk '
    /·--/ && blank_inserted == 1 { exit }  # Stop before the last boundary line
    {
        if (NF == 0) exit  # Exit when the blank line is encountered
        print
    }'
}

# Function to extract Gas Report table
extract_gas_report() {
    echo "$processed_output" | awk '
    found_blank_line == 1 { print }
    NF == 0 { found_blank_line = 1 }  # Start printing after the blank line
    '
}

code_size_output=$(extract_code_size)
gas_report_output=$(extract_gas_report)

# Write the Code Size output to a file
echo "$code_size_output" > code_size.txt

# Write the Gas Report output to a file
echo "$gas_report_output" > gas_report.txt
