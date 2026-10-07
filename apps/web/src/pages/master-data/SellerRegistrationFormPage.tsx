import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, createEnterToNextHandler } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { SellerRegistration, Status } from './types.js';

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const STATE_CODE_PATTERN = /^[0-9]{2}$/;
const PIN_CODE_PATTERN = /^[1-9][0-9]{5}$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const emptyForm = {
  legalName: '',
  tradeName: '',
  branchCode: '',
  status: 'ACTIVE' as Status,
  gstin: '',
  state: '',
  stateCode: '',
  postalCode: '',
  einvoiceApplicable: false,
  addressLine1: '',
  addressLine2: '',
  city: '',
  district: '',
  country: 'India',
  bankName: '',
  bankAccountName: '',
  bankAccountNumber: '',
  bankIfsc: '',
  bankBranchName: '',
  bankAddress: '',
};

type FormState = typeof emptyForm;

const fieldLabels: Record<keyof FormState, string> = {
  legalName: 'Legal Name',
  tradeName: 'Trade Name',
  branchCode: 'Branch Code',
  status: 'Status',
  gstin: 'GSTIN',
  state: 'State',
  stateCode: 'State Code',
  postalCode: 'PIN',
  einvoiceApplicable: 'E-Invoice Applicable',
  addressLine1: 'Address Line 1',
  addressLine2: 'Address Line 2',
  city: 'City',
  district: 'District',
  country: 'Country',
  bankName: 'Bank Name',
  bankAccountName: 'Beneficiary / Account Name',
  bankAccountNumber: 'Account Number',
  bankIfsc: 'IFSC',
  bankBranchName: 'Branch Name',
  bankAddress: 'Bank Address',
};

const requiredFieldKeys = new Set<keyof FormState>([
  'legalName',
  'branchCode',
  'gstin',
  'state',
  'stateCode',
  'postalCode',
  'addressLine1',
  'city',
  'bankName',
  'bankAccountName',
  'bankAccountNumber',
  'bankIfsc',
  'bankBranchName',
]);

const identityFieldKeys = ['legalName', 'tradeName', 'branchCode', 'status'] as const;
// Grouped with GST registration per the seller-identity form layout, not
// with the postal address below — State/State Code/PIN here describe the
// GST registration's jurisdiction.
const gstFieldKeys = ['gstin', 'state', 'stateCode', 'postalCode', 'einvoiceApplicable'] as const;
const addressFieldKeys = ['addressLine1', 'addressLine2', 'city', 'district', 'country'] as const;
const bankFieldKeys = [
  'bankName',
  'bankAccountName',
  'bankAccountNumber',
  'bankIfsc',
  'bankBranchName',
  'bankAddress',
] as const;

function cleanPayload(form: FormState) {
  const { einvoiceApplicable, ...rest } = form;
  return {
    ...Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, value === '' ? null : value])),
    einvoiceApplicable,
  } as Record<string, string | boolean | null>;
}

function toErrorMessage(caught: unknown): string {
  if (isAxiosError(caught)) {
    const message = caught.response?.data?.error?.message as string | undefined;
    if (message) return message;
  }
  return caught instanceof Error ? caught.message : 'Unable to save seller registration';
}

export function SellerRegistrationFormPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState('');

  const registrationQuery = useQuery({
    queryKey: ['seller-registration', id],
    enabled: isEdit,
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<SellerRegistration>>(
        `/seller-registrations/${id}`,
      );
      return response.data.data;
    },
  });

  useEffect(() => {
    if (!registrationQuery.data) {
      return;
    }
    const registration = registrationQuery.data;
    // Hydrates the edit form from an async-loaded record; the data isn't
    // available for a lazy initial-state computation, so this can't be done
    // without an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      legalName: registration.legalName,
      tradeName: registration.tradeName ?? '',
      branchCode: registration.branchCode,
      status: registration.status,
      gstin: registration.gstin,
      state: registration.state,
      stateCode: registration.stateCode,
      postalCode: registration.postalCode,
      einvoiceApplicable: registration.einvoiceApplicable,
      addressLine1: registration.addressLine1,
      addressLine2: registration.addressLine2 ?? '',
      city: registration.city,
      district: registration.district ?? '',
      country: registration.country,
      bankName: registration.bankName,
      bankAccountName: registration.bankAccountName,
      bankAccountNumber: registration.bankAccountNumber,
      bankIfsc: registration.bankIfsc,
      bankBranchName: registration.bankBranchName,
      bankAddress: registration.bankAddress ?? '',
    });
  }, [registrationQuery.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      for (const key of requiredFieldKeys) {
        if (!String(form[key]).trim()) {
          throw new Error(`${fieldLabels[key]} is required`);
        }
      }
      const gstin = form.gstin.trim().toUpperCase();
      if (!GSTIN_PATTERN.test(gstin)) {
        throw new Error('Enter a valid 15-character GSTIN (e.g., 22AAAAA0000A1Z5)');
      }
      const stateCode = form.stateCode.trim();
      if (!STATE_CODE_PATTERN.test(stateCode)) {
        throw new Error('Enter a valid 2-digit GST state code');
      }
      if (gstin.slice(0, 2) !== stateCode) {
        throw new Error('GST state code must match the first two digits of the GSTIN');
      }
      if (!PIN_CODE_PATTERN.test(form.postalCode.trim())) {
        throw new Error('Enter a valid 6-digit PIN code');
      }
      const bankIfsc = form.bankIfsc.trim().toUpperCase();
      if (!IFSC_PATTERN.test(bankIfsc)) {
        throw new Error('Enter a valid 11-character IFSC code (e.g., HDFC0001234)');
      }
      const payload = {
        ...cleanPayload(form),
        gstin,
        stateCode,
        bankIfsc,
      };
      const response = isEdit
        ? await apiClient.patch<ApiSuccessResponse<SellerRegistration>>(
            `/seller-registrations/${id}`,
            payload,
          )
        : await apiClient.post<ApiSuccessResponse<SellerRegistration>>(
            '/seller-registrations',
            payload,
          );
      return response.data.data;
    },
    onSuccess: async (registration) => {
      await queryClient.invalidateQueries({ queryKey: ['seller-registrations'] });
      await queryClient.invalidateQueries({ queryKey: ['seller-registration', registration.id] });
      navigate(`/master-data/seller-registrations/${registration.id}`);
    },
    onError: (caught) => setError(toErrorMessage(caught)),
  });

  if (isEdit && registrationQuery.isLoading) {
    return <LoadingState label="Loading seller registration" />;
  }
  if (isEdit && registrationQuery.isError) {
    return (
      <ErrorState
        title="Unable to load seller registration"
        description={registrationQuery.error.message}
      />
    );
  }

  function renderField(key: keyof FormState) {
    if (key === 'status') {
      return (
        <SelectField
          key={key}
          label="Status"
          value={form.status}
          onValueChange={(value) => setForm((current) => ({ ...current, status: value as Status }))}
          width="fill"
        >
          <SelectItem value="ACTIVE">Active</SelectItem>
          <SelectItem value="INACTIVE">Inactive</SelectItem>
        </SelectField>
      );
    }
    if (key === 'einvoiceApplicable') {
      return (
        <SelectField
          key={key}
          label="E-Invoice Applicable"
          value={form.einvoiceApplicable ? 'YES' : 'NO'}
          onValueChange={(value) =>
            setForm((current) => ({ ...current, einvoiceApplicable: value === 'YES' }))
          }
          width="fill"
        >
          <SelectItem value="NO">No</SelectItem>
          <SelectItem value="YES">Yes</SelectItem>
        </SelectField>
      );
    }
    return (
      <TextField
        key={key}
        label={fieldLabels[key]}
        required={requiredFieldKeys.has(key)}
        value={form[key] as string}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? 'Edit Seller Registration' : 'Create Seller Registration'}
        subtitle={
          isEdit
            ? 'Update this ERVE Branch / Seller Registration record'
            : 'Create a new ERVE Branch / Seller Registration record'
        }
        secondaryActions={
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        }
      />

      <Panel>
        <form
          noValidate
          className="space-y-6"
          onKeyDown={createEnterToNextHandler()}
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <FormSection title="Seller Identity">
            <FormGrid columns={3}>{identityFieldKeys.map(renderField)}</FormGrid>
          </FormSection>

          <FormSection title="GST Registration">
            <FormGrid columns={3}>{gstFieldKeys.map(renderField)}</FormGrid>
          </FormSection>

          <FormSection title="Registered Address">
            <FormGrid columns={3}>{addressFieldKeys.map(renderField)}</FormGrid>
          </FormSection>

          <FormSection title="Bank Details">
            <FormGrid columns={3}>{bankFieldKeys.map(renderField)}</FormGrid>
          </FormSection>

          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}

          <div className="flex justify-end gap-3 border-t border-border-subtle pt-4">
            <Button type="submit" loading={mutation.isPending}>
              {isEdit ? 'Save Changes' : 'Create Seller Registration'}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
