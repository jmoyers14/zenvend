import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { queryClient, trpc } from "../../trpc.ts";
import {
  DeleteSection,
  ErrorNote,
  eyebrowLinkClass,
  Field,
  FieldRow,
  FormSection,
  Page,
  PageHeader,
  pageLinkClass,
  SaveBar,
  Select,
  TextInput,
  useRecordForm,
} from "../../ui.tsx";
import { MACHINE_KIND_LABELS, type MachineKind } from "./machineKind.ts";
import { SlotsField } from "./SlotsField.tsx";
import {
  buildTemplateInput,
  draftFor,
  EMPTY_TEMPLATE_DRAFT,
  fieldErrorsFor,
  makeModelFor,
} from "./templateForm.ts";

const FORM_ID = "template-form";

/** Create + edit form: `templateId` present means edit. */
export function MachineTemplateFormScreen({ templateId }: { templateId?: string }) {
  const templateQuery = useQuery({
    ...trpc.machineTemplates.get.queryOptions({ id: templateId ?? "" }),
    enabled: Boolean(templateId),
  });
  const form = useRecordForm({
    recordId: templateId,
    record: templateQuery.data,
    emptyDraft: EMPTY_TEMPLATE_DRAFT,
    draftFor,
    listPath: "/machines/templates",
    savedQueryKey: trpc.machineTemplates.pathKey(),
  });
  const { draft, errors, editDraft, isEditing } = form;
  const create = useMutation(trpc.machineTemplates.create.mutationOptions(form.saveCallbacks));
  const update = useMutation(trpc.machineTemplates.update.mutationOptions(form.saveCallbacks));

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    form.setFormError(null);
    const fieldErrors = fieldErrorsFor(draft);
    form.setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      return;
    }
    const input = buildTemplateInput(draft);
    if (templateId) {
      update.mutate({ id: templateId, ...input });
      return;
    }
    create.mutate(input);
  };

  const savedTemplate = templateQuery.data;
  const savedMakeModel = savedTemplate ? makeModelFor(savedTemplate) : null;

  return (
    <>
      <Page max="form" className="grid gap-8">
        <PageHeader
          eyebrow={
            <>
              <Link to="/machines" className={eyebrowLinkClass}>
                Machines
              </Link>{" "}
              /{" "}
              <Link to="/machines/templates" className={eyebrowLinkClass}>
                Templates
              </Link>{" "}
              / {isEditing ? "Edit template" : "New template"}
            </>
          }
          title={isEditing ? (savedTemplate?.name ?? "…") : "New template"}
          meta={savedMakeModel ?? undefined}
          aside={
            <Link to="/machines/templates" className={pageLinkClass}>
              ← Back to templates
            </Link>
          }
        />

        <ErrorNote
          message={
            templateQuery.error
              ? `Couldn't load this template: ${templateQuery.error.message}`
              : null
          }
        />
        {isEditing && templateQuery.isLoading ? (
          <p className="text-body text-muted-strong">Loading…</p>
        ) : null}

        {form.canShowForm ? (
          <form id={FORM_ID} onSubmit={handleSubmit} noValidate>
            <FormSection title="Template" description="The kind of machine this layout fits.">
              <FieldRow>
                <Field label="Name" error={errors.name} hint="e.g. AMS 39, 6 shelves">
                  <TextInput
                    value={draft.name}
                    onChange={(event) => editDraft({ name: event.target.value })}
                  />
                </Field>
                <Field label="Type">
                  <Select
                    value={draft.kind}
                    onChange={(event) => editDraft({ kind: event.target.value as MachineKind })}
                  >
                    {Object.entries(MACHINE_KIND_LABELS).map(([kind, label]) => (
                      <option key={kind} value={kind}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </FieldRow>
              <FieldRow>
                <Field label="Make" isOptional>
                  <TextInput
                    value={draft.make}
                    onChange={(event) => editDraft({ make: event.target.value })}
                  />
                </Field>
                <Field label="Model" isOptional>
                  <TextInput
                    value={draft.model}
                    onChange={(event) => editDraft({ model: event.target.value })}
                  />
                </Field>
              </FieldRow>
            </FormSection>

            <FormSection
              title="Layout"
              description="The slots as you see them standing in front of the machine. New machines copy it."
            >
              <SlotsField
                // Remounts when the saved layout arrives, so the grid controls open to fit it.
                key={String(form.hasLoaded)}
                value={draft.slots}
                error={errors.slots}
                onChange={(slots) => editDraft({ slots })}
              />
            </FormSection>
          </form>
        ) : null}

        {form.formError ? (
          <div ref={form.formErrorRef} className="scroll-mb-28">
            <ErrorNote message={form.formError} />
          </div>
        ) : null}

        {templateId && savedTemplate ? (
          <DeleteTemplateSection templateId={templateId} templateName={savedTemplate.name} />
        ) : null}
      </Page>
      <SaveBar
        isDirty={form.isDirty}
        // "All changes saved" would be untrue for a template that doesn't exist yet.
        summary={!isEditing && !form.isDirty ? "Nothing entered yet" : undefined}
        saveLabel={isEditing ? "Save changes" : "Create template"}
        dismissal={isEditing ? "discard" : "cancel"}
        onDismiss={form.handleDismiss}
        formId={FORM_ID}
        isSaving={create.isPending || update.isPending}
      />
    </>
  );
}

/** Machines keep their own copy of a layout, so deleting a template never changes one. */
function DeleteTemplateSection({
  templateId,
  templateName,
}: {
  templateId: string;
  templateName: string;
}) {
  const navigate = useNavigate();
  const remove = useMutation(
    trpc.machineTemplates.remove.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.machineTemplates.list.queryKey() });
        navigate({ to: "/machines/templates" });
      },
    }),
  );
  return (
    <DeleteSection
      recordKind="template"
      recordName={templateName}
      description="Machines made from it keep their layout."
      isDeleting={remove.isPending}
      error={remove.error?.message ?? null}
      onDelete={() => remove.mutate({ id: templateId })}
      onDismiss={() => remove.reset()}
    />
  );
}
