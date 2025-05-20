import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InputTypeSelect, SelectableInputTypes } from './InputTypeSelect';

const inputTypes = [
  { value: SelectableInputTypes.SELECT, label: 'Select', placeholderText: 'Select placeholder' },
  { value: SelectableInputTypes.TEXT, label: 'Text', placeholderText: 'Text placeholder' },
  { value: SelectableInputTypes.REGEX, label: 'Regex', placeholderText: 'Regex placeholder' },
  { value: SelectableInputTypes.ID, label: 'ID', placeholderText: 'ID placeholder' },
];

describe('InputTypeSelect', () => {
  it('renders the current type as button label', () => {
    render(<InputTypeSelect selectedType={SelectableInputTypes.TEXT} inputTypes={inputTypes} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /currently Text/i })).toBeInTheDocument();
  });

  it('renders all input types in dropdown menu', async () => {
    render(<InputTypeSelect selectedType={SelectableInputTypes.SELECT} inputTypes={inputTypes} onChange={() => {}} />);
    // Open the dropdown
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Select')).toBeInTheDocument();
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByText('Regex')).toBeInTheDocument();
    expect(screen.getByText('ID')).toBeInTheDocument();
  });

  it('calls onChange with correct value when menu item is clicked', async () => {
    const handleChange = jest.fn();
    render(
      <InputTypeSelect selectedType={SelectableInputTypes.SELECT} inputTypes={inputTypes} onChange={handleChange} />
    );
    // Open the dropdown
    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(screen.getByText('Regex'));
    expect(handleChange).toHaveBeenCalledWith(SelectableInputTypes.REGEX);
  });
});
