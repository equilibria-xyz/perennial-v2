#!/bin/bash

# Output file path
output_file="code_size.txt"

# Run the command and filter lines that start with '|' or '·', removing color codes
filtered_output=$(yarn workspaces run build | grep -E '^\s*(\||·)' | sed -r 's/\x1B\[[0-9;]*[mK]//g')

# Extract only the core contracts table
core_code_size_table=$(echo "$filtered_output" | awk '
    /·--/ {
        # Capture first table starting and ending with ·--
        if (capturing) {
            print
            exit
        }
        capturing = 1
    }
    capturing {
        print
    }
')

# Format the captured table for GitHub comment with collapsible section
formatted_core_code_size_table="<details>\n<summary>View Report</summary>\n\n\`\`\`\n$core_code_size_table\n\`\`\`\n</details>"

# Write the formatted table to the output file
printf "%b" "$formatted_core_code_size_table" > "$output_file"
