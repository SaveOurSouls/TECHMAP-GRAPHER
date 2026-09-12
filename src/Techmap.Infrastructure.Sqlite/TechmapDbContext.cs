using Microsoft.EntityFrameworkCore;

namespace Techmap.Infrastructure.Sqlite;

public sealed class TechmapDbContext(DbContextOptions<TechmapDbContext> options)
    : DbContext(options);
