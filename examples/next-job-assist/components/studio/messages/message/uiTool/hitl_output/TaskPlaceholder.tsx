export const TaskPlaceholder = ({
  taskId,
  fullOutput,
  mcpName,
  toolName,
}: {
  taskId: string;
  fullOutput: any;
  mcpName: string;
  toolName: string;
}) => {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-6">
        <p>{fullOutput.backgroundTask.message}</p>
      </div>
    </div>
  );
};
