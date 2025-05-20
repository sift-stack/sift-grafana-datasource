import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SelectableTypeInput } from './SelectableTypeInput';
import { SelectableInputTypes } from './InputTypeSelect';
import { SelectableValue } from '@grafana/data';

const selectableTypes = [
  {
    value: SelectableInputTypes.SELECT,
    label: 'Select',
    description: 'Select a value',
    placeholderText: 'Select placeholder',
  },
  { value: SelectableInputTypes.TEXT, label: 'Text', description: 'Enter text', placeholderText: 'Text placeholder' },
];

const allSelectableTypes = [
  {
    value: SelectableInputTypes.SELECT,
    label: 'Select',
    description: 'Select a value',
    placeholderText: 'Select placeholder',
  },
  { value: SelectableInputTypes.TEXT, label: 'Text', description: 'Enter text', placeholderText: 'Text placeholder' },
  {
    value: SelectableInputTypes.REGEX,
    label: 'Regex',
    description: 'Regex pattern',
    placeholderText: 'Regex placeholder',
  },
  { value: SelectableInputTypes.ID, label: 'ID', description: 'Enter ID', placeholderText: 'ID placeholder' },
  {
    value: SelectableInputTypes.DASHBOARD,
    label: 'Dashboard',
    description: 'Select a dashboard variable',
    placeholderText: 'Dashboard vars placeholder',
  },
];
const selectableValues: Array<SelectableValue<string>> = [
  { value: 'foo', label: 'Foo' },
  { value: 'bar', label: 'Bar' },
  { value: 'fooBar', label: 'Foo.Bar' },
];

describe('SelectableTypeInput', () => {
  it('renders Select when selectedType is SELECT', async () => {
    render(
      <SelectableTypeInput
        value="foo"
        onUpdate={jest.fn()}
        onSelectType={jest.fn()}
        onSelectFilter={jest.fn()}
        selectedType={SelectableInputTypes.SELECT}
        selectableTypes={selectableTypes}
        selectableValues={selectableValues}
      />
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders ExpandableTextInput when selectedType is TEXT', async () => {
    render(
      <SelectableTypeInput
        value="bar"
        onUpdate={jest.fn()}
        onSelectType={jest.fn()}
        onSelectFilter={jest.fn()}
        selectedType={SelectableInputTypes.TEXT}
        selectableTypes={selectableTypes}
        selectableValues={selectableValues}
      />
    );
    expect(screen.getByPlaceholderText('Text placeholder')).toBeInTheDocument();
  });

  it('calls onUpdate and onSelectType when input type changes', async () => {
    const onUpdate = jest.fn();
    const onSelectType = jest.fn();
    render(
      <SelectableTypeInput
        value="foo"
        onUpdate={onUpdate}
        onSelectType={onSelectType}
        onSelectFilter={jest.fn()}
        selectedType={SelectableInputTypes.SELECT}
        selectableTypes={allSelectableTypes}
        selectableValues={selectableValues}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /Change input type/i }));
    await userEvent.click(screen.getByText('Text'));
    expect(onSelectType).toHaveBeenCalledWith(SelectableInputTypes.TEXT);
    expect(onUpdate).toHaveBeenCalled();
  });

  it('calls onSelectFilter when filter is selected', async () => {
    const onSelectFilter = jest.fn();
    render(
      <SelectableTypeInput
        value="foo"
        onUpdate={jest.fn()}
        onSelectType={jest.fn()}
        onSelectFilter={onSelectFilter}
        selectedType={SelectableInputTypes.SELECT}
        selectableTypes={allSelectableTypes}
        selectableValues={selectableValues}
      />
    );
    const inputSelect = screen.getByRole('combobox');
    await userEvent.click(inputSelect);
    await userEvent.type(inputSelect, 'bar');
    expect(onSelectFilter).toHaveBeenCalledWith('bar', expect.any(Object));
  });

  it('renders all selectable types in the type dropdown', async () => {
    render(
      <SelectableTypeInput
        value="foo"
        onUpdate={jest.fn()}
        onSelectType={jest.fn()}
        onSelectFilter={jest.fn()}
        selectedType={SelectableInputTypes.SELECT}
        selectableTypes={allSelectableTypes}
        selectableValues={selectableValues}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /Change input type/i }));
    expect(screen.getByText('Select')).toBeInTheDocument();
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByText('Regex')).toBeInTheDocument();
    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('changes type appropriately and calls onUpdate correctly', async () => {
    const onUpdate = jest.fn();
    function Wrapper() {
      const [type, setType] = React.useState(SelectableInputTypes.SELECT);
      const [value, setValue] = React.useState('');
      return (
        <SelectableTypeInput
          value={value}
          onUpdate={(val, typ) => {
            setValue(typeof val === 'string' ? val : val?.value || '');
            onUpdate(val, typ);
          }}
          onSelectType={setType}
          onSelectFilter={jest.fn()}
          selectedType={type}
          selectableTypes={allSelectableTypes}
          selectableValues={selectableValues}
          isLoading={false}
        />
      );
    }

    render(<Wrapper />);
    const changeTypeButton = screen.getByRole('button', { name: /change input type/i });
    await userEvent.click(changeTypeButton);

    const regexMenuItem = screen.getByRole('menuitem', { name: /regex/i });
    await userEvent.click(regexMenuItem);
    expect(screen.getByTestId('regex-icon')).toBeInTheDocument();

    const inputBox = screen.getByRole('textbox');
    expect(inputBox).toHaveAttribute('placeholder', 'Regex placeholder');
    await userEvent.type(inputBox, 'Hello World{enter}');
    await userEvent.tab();

    expect(onUpdate).toHaveBeenCalledWith('Hello World', SelectableInputTypes.REGEX);

    // Switch to 1st select
    await userEvent.click(changeTypeButton);
    const selectMenuItem = screen.getByRole('menuitem', { name: /select a value/i });
    await userEvent.click(selectMenuItem);

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText(/select placeholder/i)).toBeInTheDocument();
    expect(screen.getByTestId('select-icon')).toBeInTheDocument();

    const selectInput = screen.getByRole('combobox');
    await userEvent.click(selectInput);
    expect(screen.getByText('Foo')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Foo'));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'foo', label: 'Foo' }),
      SelectableInputTypes.SELECT
    );

    // Switch to 2nd select
    await userEvent.click(changeTypeButton);
    const selectVarMenuItem = screen.getByRole('menuitem', { name: /select a dashboard variable/i });
    await userEvent.click(selectVarMenuItem);

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    // should have been deselected when switched to variable select
    expect(screen.getByText(/dashboard vars placeholder/i)).toBeInTheDocument();

    const selectVarInput = screen.getByRole('combobox');
    await userEvent.click(selectVarInput);
    expect(screen.getByText('Bar')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Bar'));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'bar', label: 'Bar' }),
      SelectableInputTypes.DASHBOARD
    );

    // switch back again just to be sure no incorrect residual state
    await userEvent.click(changeTypeButton);
    const selectMenuItem2 = screen.getByRole('menuitem', { name: /select a value/i });
    await userEvent.click(selectMenuItem2);
    expect(screen.getByTestId('select-icon')).toBeInTheDocument();

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('Foo')).toBeInTheDocument();
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'foo', label: 'Foo' }),
      SelectableInputTypes.SELECT
    );

    // switch back to text input
    await userEvent.click(changeTypeButton);
    const textMenuItem = screen.getByRole('menuitem', { name: /text/i });
    await userEvent.click(textMenuItem);
    expect(screen.getByTestId('text-fields')).toBeInTheDocument();
    const inputBox2 = screen.getByRole('textbox');
    expect(inputBox2).toHaveValue('Foo');
    await userEvent.clear(inputBox2);

    // switch to id
    await userEvent.click(changeTypeButton);
    const idMenuItem = screen.getByRole('menuitem', { name: /id/i });
    await userEvent.click(idMenuItem);
    expect(screen.getByTestId('key-skeleton-alt')).toBeInTheDocument();
    const inputBox3 = screen.getByRole('textbox');
    expect(inputBox3).toHaveValue('');

    // switch back to select input, should be cleared
    await userEvent.click(changeTypeButton);
    const selectMenuItem3 = screen.getByRole('menuitem', { name: /select a value/i });
    await userEvent.click(selectMenuItem3);

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText(/Foo/i)).toBeInTheDocument();
  });

  it('changes from select to text, id, regex set correctly', async () => {
    const onUpdate = jest.fn();
    function Wrapper() {
      const [type, setType] = React.useState(SelectableInputTypes.SELECT);
      const [value, setValue] = React.useState('');
      return (
        <SelectableTypeInput
          value={value}
          onUpdate={(val, typ) => {
            setValue(typeof val === 'string' ? val : val?.value || '');
            onUpdate(val, typ);
          }}
          onSelectType={setType}
          onSelectFilter={jest.fn()}
          selectedType={type}
          selectableTypes={allSelectableTypes}
          selectableValues={selectableValues}
          isLoading={false}
        />
      );
    }

    render(<Wrapper />);
    const changeTypeButton = screen.getByRole('button', { name: /change input type/i });
    // Switch to select
    await userEvent.click(changeTypeButton);
    const selectMenuItem = screen.getByRole('menuitem', { name: /select a value/i });
    await userEvent.click(selectMenuItem);

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText(/select placeholder/i)).toBeInTheDocument();
    expect(screen.getByTestId('select-icon')).toBeInTheDocument();

    const selectInput = screen.getByRole('combobox');
    await userEvent.click(selectInput);
    expect(screen.getByText(/foo.bar/i)).toBeInTheDocument();
    await userEvent.click(screen.getByText(/foo.bar/i));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'fooBar', label: 'Foo.Bar' }),
      SelectableInputTypes.SELECT
    );

    // switch back to text input, should have label
    await userEvent.click(changeTypeButton);
    const textMenuItem = screen.getByRole('menuitem', { name: /text/i });
    await userEvent.click(textMenuItem);
    expect(screen.getByTestId('text-fields')).toBeInTheDocument();
    const inputBox = screen.getByRole('textbox');
    expect(inputBox).toHaveValue('Foo.Bar');

    // Switch to select
    await userEvent.click(changeTypeButton);
    const selectMenuItem2 = screen.getByRole('menuitem', { name: /select a value/i });
    await userEvent.click(selectMenuItem2);

    // switch to id, should have value
    await userEvent.click(changeTypeButton);
    const idMenuItem = screen.getByRole('menuitem', { name: /id/i });
    await userEvent.click(idMenuItem);
    expect(screen.getByTestId('key-skeleton-alt')).toBeInTheDocument();
    const inputBox2 = screen.getByRole('textbox');
    expect(inputBox2).toHaveValue('fooBar');

    // Switch to select
    await userEvent.click(changeTypeButton);
    const selectMenuItem3 = screen.getByRole('menuitem', { name: /select a value/i });
    await userEvent.click(selectMenuItem3);

    // switch to regex, should have label but escaped as regex
    await userEvent.click(changeTypeButton);
    const regexMenuItem = screen.getByRole('menuitem', { name: /regex/i });
    await userEvent.click(regexMenuItem);
    expect(screen.getByTestId('regex-icon')).toBeInTheDocument();
    const inputBox3 = screen.getByRole('textbox');
    expect(inputBox3).toHaveValue('^Foo\\.Bar$');
  });

  it('calls onSelectFilter when user types in the select input', async () => {
    const onSelectFilter = jest.fn();
    function Wrapper() {
      const [type, setType] = React.useState(SelectableInputTypes.SELECT);
      const [value, setValue] = React.useState('');
      return (
        <SelectableTypeInput
          value={value}
          onUpdate={(val, typ) => setValue(typeof val === 'string' ? val : val?.value || '')}
          onSelectType={setType}
          onSelectFilter={onSelectFilter}
          selectedType={type}
          selectableTypes={allSelectableTypes}
          selectableValues={selectableValues}
          isLoading={false}
        />
      );
    }
    render(<Wrapper />);
    const selectInput = screen.getByRole('combobox');
    await userEvent.click(selectInput);
    // Type in the select input (simulate filter)
    await userEvent.type(selectInput, 'abc');
    await waitFor(() => {
      expect(onSelectFilter).toHaveBeenCalledWith('abc', expect.any(Object));
    });
  });
});
