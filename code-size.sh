#!/bin/bash

# Output file path
output_file="code_size.txt"

# Run the command and capture output directly
filtered_output=$(yarn workspaces run build | grep -E '^\s*(\||·)' | sed -r 's/\x1B\[[0-9;]*[mK]//g')

# Extract only the core contracts table
core_code_size_table=$(echo "$filtered_output" | awk '
    /·--/ {  # Boundary line indicates the start of a new table
        if (capturing) {
            # Save the current table content as the last table, including this boundary line
            last_table_content = table_content $0 "\n"
        }
        # Start a new table capture, and include the boundary line in table_content
        capturing = 1
        table_content = $0 "\n"  # Reset and start with boundary line
        next
    }
    capturing {  # Collect lines for the current table, including boundaries
        table_content = table_content $0 "\n"
    }
    END {
        # Output the last captured table with both boundaries
        print last_table_content
    }
')

# Write the last table to the output file
echo "$core_code_size_table" > "$output_file"
