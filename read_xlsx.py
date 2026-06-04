import pandas as pd
import json

xls = pd.ExcelFile('2026年灵工发放表格-20260601-V2.xlsx')
df = pd.read_excel(xls, sheet_name=xls.sheet_names[0], header=None)
print(f'Shape: {df.shape}')
print(f'Sheet: {xls.sheet_names[0]}')
print()

# Print all rows with their content
for i in range(min(df.shape[0], 25)):
    row_data = []
    for j in range(df.shape[1]):
        val = df.iloc[i, j]
        if pd.notna(val):
            row_data.append(f'[{j}]={val}')
    print(f'Row {i}: {", ".join(row_data)}')
