using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;
namespace Techmap.Web.Tests;
public sealed class GlobalMaterialPersistenceTests
{
    [Fact]
    public async Task Global_rows_and_png_bytes_survive_reopen_and_are_in_backup_without_projects()
    {
        var root=Path.Combine(Path.GetTempPath(),"techmap-material-tests",Guid.NewGuid().ToString("N"));
        var backups=Path.Combine(Path.GetTempPath(),"techmap-material-backups",Guid.NewGuid().ToString("N"));
        GlobalMaterial saved;
        using(var storage=SqliteStorage.Open(root))
        {
            var store=new SqliteGlobalMaterialLibrary(storage);
            foreach(var item in store.List())
            {
                var full=store.Get(item.MaterialId);
                // Force every shipped texture through exactly the same validator as uploaded PNGs.
                store.Update(full);
            }
            var seed=store.Get(store.List()[0].MaterialId);
            saved=store.Create(seed with {MaterialId=Guid.NewGuid(),Name="Backup fixture",CoveringKind=null,Revision=0,Tint="#ffffff"});
        }
        using(var storage=SqliteStorage.Open(root))
        {
            Assert.Equal(saved,new SqliteGlobalMaterialLibrary(storage).Get(saved.MaterialId));
            using var service=new SqliteStorageBackupService(root,storage.Layout.DatabasePath);
            var backup=await service.CreateAsync(new StorageBackupRequest(backups,"0.60.0-m4-110"),TestContext.Current.CancellationToken);
            using var database=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=Path.Combine(backup.BackupPath,"app.db"),Mode=SqliteOpenMode.ReadOnly,Pooling=false}.ToString());
            database.Open();using var command=database.CreateCommand();command.CommandText="SELECT image_png FROM global_materials WHERE material_id=$id";command.Parameters.AddWithValue("$id",saved.MaterialId.ToString("D"));
            Assert.Equal(Convert.FromBase64String(saved.ImageBase64),(byte[])command.ExecuteScalar()!);
            command.CommandText="SELECT COUNT(*) FROM projects";command.Parameters.Clear();Assert.Equal(0L,command.ExecuteScalar());
        }
    }
}
