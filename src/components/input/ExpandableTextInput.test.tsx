import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { ExpandableTextInput } from './ExpandableTextInput';

// Test value and onChange
it('calls onChange when input changes', () => {
  const handleChange = jest.fn();
  render(<ExpandableTextInput value="foo" onChange={handleChange} />);
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'bar' } });
  expect(handleChange).toHaveBeenCalledWith('bar');
});

// Test onBlur
it('calls onBlur when input loses focus', () => {
  const handleBlur = jest.fn();
  render(<ExpandableTextInput value="baz" onBlur={handleBlur} />);
  const input = screen.getByRole('textbox');
  fireEvent.blur(input, { target: { value: 'baz' } });
  expect(handleBlur).toHaveBeenCalledWith('baz');
});

// Test automatic resizing (data-value attribute on parent)
it('sets data-value on parent for auto-resizing when value changes', () => {
  render(<ExpandableTextInput value="foo" />);
  const input = screen.getByRole('textbox');
  const parent = input.parentElement;
  expect(parent).toHaveAttribute('data-value', 'foo');

  // Simulate change
  fireEvent.change(input, { target: { value: 'barbaz' } });
  // The handler sets data-value on parent
  expect(parent).toHaveAttribute('data-value', 'barbaz');
});

it('updates data-value on parent when props.value changes', () => {
  const { rerender } = render(<ExpandableTextInput value="short" />);
  const input = screen.getByRole('textbox');
  const parent = input.parentElement;
  expect(parent).toHaveAttribute('data-value', 'short');

  // Simulate external prop change
  rerender(<ExpandableTextInput value="muchlongertext" />);
  expect(parent).toHaveAttribute('data-value', 'muchlongertext');
});
