# Ledger App 完整开发计划

## 项目概述

构建一个支持个人记账和家庭共享账本的跨平台记账应用。

- **前端**: Flutter (iOS/Android/Web)
- **后端**: Node.js + TypeScript + NestJS
- **数据库**: PostgreSQL + Redis

---

## 第一部分：Flutter 前端开发计划

### 阶段一：项目基础搭建

#### 1.1 依赖配置
**文件**: `pubspec.yaml`

添加以下依赖：
```yaml
dependencies:
  # 数据库
  sqflite: ^2.3.0
  path_provider: ^2.1.1
  
  # 图表
  fl_chart: ^0.66.0
  
  # 本地存储
  shared_preferences: ^2.2.2
  
  # 依赖注入
  get_it: ^8.0.3
  injectable: ^2.5.0
  
  # 工具
  intl: ^0.19.0
  uuid: ^4.2.1
  csv: ^6.0.0
  freezed_annotation: ^2.4.4
  json_annotation: ^4.9.0
  
  # 网络请求（已有）
  dio: ^5.8.0+1
  
  # 状态管理（Cubit）
  flutter_bloc: ^9.0.0
  
  # UI 组件（已有）
  tdesign_flutter: ^0.2.6
  flutter_screenutil: ^5.9.3
  flutter_easyloading: ^3.0.5
  
  # 路由（已有）
  fluro: ^2.0.5
  
  # 日志（已有）
  logger: ^2.6.1
  
  # 日期格式化（已有）
  date_format: ^2.0.9
  
dev_dependencies:
  build_runner: ^2.4.15
  freezed: ^2.5.8
  json_serializable: ^6.9.4
  injectable_generator: ^2.7.0
```

#### 1.2 项目目录结构（Cubit 架构 - 按功能模块组织）

采用 **Cubit** 状态管理，将 cubit、state、view 按页面/模块放在同一文件夹下，结构更清晰、维护更方便。

```
lib/
├── main.dart                            # 应用入口
├── app.dart                             # 应用配置（路由、主题）
├── config/
│   ├── theme.dart                       # 主题配置
│   ├── constants.dart                   # 常量定义
│   └── routes.dart                      # 路由配置
├── core/                                # 核心基础设施
│   ├── database/
│   │   ├── database_provider.dart       # SQLite 数据库
│   │   └── database_helper.dart         # 数据库工具
│   ├── network/
│   │   ├── api_client.dart              # Dio HTTP 客户端
│   │   ├── api_endpoints.dart           # API 端点定义
│   │   └── network_interceptor.dart     # 网络拦截器
│   ├── storage/
│   │   └── preferences.dart             # SharedPreferences
│   └── di/                              # 依赖注入
│       └── service_locator.dart         # GetIt 配置
├── models/                              # 数据模型（纯 Dart 类）
│   ├── user.dart
│   ├── transaction.dart
│   ├── category.dart
│   ├── account.dart
│   ├── budget.dart
│   ├── family.dart
│   └── family_member.dart
├── repositories/                        # 数据仓库层
│   ├── auth_repository.dart
│   ├── transaction_repository.dart
│   ├── category_repository.dart
│   ├── account_repository.dart
│   ├── family_repository.dart
│   └── budget_repository.dart
├── features/                            # 功能模块（每个模块包含 cubit + state + view）
│   ├── splash/
│   │   ├── cubit/
│   │   │   ├── splash_cubit.dart
│   │   │   └── splash_state.dart
│   │   └── view/
│   │       └── splash_page.dart
│   │
│   ├── auth/
│   │   ├── cubit/
│   │   │   ├── auth_cubit.dart
│   │   │   └── auth_state.dart
│   │   └── view/
│   │       ├── login_page.dart
│   │       └── register_page.dart
│   │
│   ├── home/
│   │   ├── cubit/
│   │   │   ├── home_cubit.dart
│   │   │   └── home_state.dart
│   │   ├── view/
│   │   │   └── home_page.dart
│   │   └── widgets/
│   │       ├── summary_card.dart
│   │       ├── quick_actions.dart
│   │       ├── recent_transactions.dart
│   │       └── ledger_switcher.dart     # 个人/家庭账本切换
│   │
│   ├── transaction/
│   │   ├── cubit/
│   │   │   ├── transaction_list_cubit.dart
│   │   │   ├── transaction_list_state.dart
│   │   │   ├── add_transaction_cubit.dart
│   │   │   └── add_transaction_state.dart
│   │   ├── view/
│   │   │   ├── transaction_list_page.dart
│   │   │   ├── transaction_detail_page.dart
│   │   │   └── add_transaction_page.dart
│   │   └── widgets/
│   │       ├── amount_input.dart
│   │       ├── category_selector.dart
│   │       ├── date_picker.dart
│   │       └── family_share_toggle.dart # 家庭共享开关
│   │
│   ├── statistics/
│   │   ├── cubit/
│   │   │   ├── statistics_cubit.dart
│   │   │   └── statistics_state.dart
│   │   ├── view/
│   │   │   └── statistics_page.dart
│   │   └── widgets/
│   │       ├── trend_chart.dart
│   │       ├── category_chart.dart
│   │       ├── budget_progress.dart
│   │       └── time_period_selector.dart
│   │
│   ├── family/                          # 家庭账本模块
│   │   ├── cubit/
│   │   │   ├── family_cubit.dart        # 家庭列表、创建、加入
│   │   │   ├── family_state.dart
│   │   │   ├── family_detail_cubit.dart # 家庭详情、成员管理
│   │   │   ├── family_detail_state.dart
│   │   │   ├── family_transactions_cubit.dart # 家庭账单
│   │   │   └── family_transactions_state.dart
│   │   ├── view/
│   │   │   ├── family_list_page.dart
│   │   │   ├── create_family_page.dart
│   │   │   ├── join_family_page.dart
│   │   │   ├── family_detail_page.dart
│   │   │   └── family_transactions_page.dart
│   │   └── widgets/
│   │       ├── family_card.dart
│   │       ├── family_member_list.dart
│   │       ├── family_summary.dart
│   │       ├── invite_code_input.dart
│   │       └── member_role_badge.dart
│   │
│   ├── profile/
│   │   ├── cubit/
│   │   │   ├── profile_cubit.dart
│   │   │   └── profile_state.dart
│   │   ├── view/
│   │   │   └── profile_page.dart
│   │   └── widgets/
│   │       └── profile_header.dart
│   │
│   ├── account_management/
│   │   ├── cubit/
│   │   │   ├── account_cubit.dart
│   │   │   └── account_state.dart
│   │   └── view/
│   │       └── account_management_page.dart
│   │
│   ├── category_management/
│   │   ├── cubit/
│   │   │   ├── category_cubit.dart
│   │   │   └── category_state.dart
│   │   └── view/
│   │       └── category_management_page.dart
│   │
│   └── budget/
│       ├── cubit/
│       │   ├── budget_cubit.dart
│       │   └── budget_state.dart
│       └── view/
│           └── budget_setting_page.dart
│
├── shared/                              # 共享组件和工具
│   ├── widgets/
│   │   ├── common/
│   │   │   ├── empty_state.dart
│   │   │   ├── loading_indicator.dart
│   │   │   ├── error_retry.dart
│   │   │   └── confirm_dialog.dart
│   │   └── charts/
│   │       ├── pie_chart.dart
│   │       ├── line_chart.dart
│   │       └── bar_chart.dart
│   └── utils/
│       ├── date_utils.dart
│       ├── money_utils.dart
│       ├── validators.dart
│       └── extensions.dart
│
└── app_bloc_observer.dart               # Cubit 全局观察者
```

### 阶段二：数据模型设计

#### 2.1 用户模型 (User)
```dart
class User {
  final String id;
  final String username;
  final String email;
  final String? avatar;
  final String? phone;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String? currentFamilyId;  // 当前选中的家庭ID
}
```

#### 2.2 账单模型 (Transaction)
```dart
class Transaction {
  final String id;
  final String userId;
  final String? familyId;         // 关联的家庭ID（可为空）
  final TransactionType type;     // 收入/支出
  final double amount;
  final String categoryId;
  final String? subCategoryId;
  final String accountId;
  final DateTime date;
  final String? note;
  final String? tags;
  final String? location;
  final bool isFamilyShared;      // 是否计入家庭账本
  final DateTime createdAt;
  final DateTime updatedAt;
  final bool isSynced;            // 是否已同步到云端
}

enum TransactionType { income, expense }
```

#### 2.3 分类模型 (Category)
```dart
class Category {
  final String id;
  final String userId;
  final String? familyId;         // 家庭共享分类
  final String name;
  final CategoryType type;
  final String icon;
  final String color;
  final int sortOrder;
  final bool isDefault;
  final bool isFamilyShared;
}

enum CategoryType { income, expense }
```

#### 2.4 账户模型 (Account)
```dart
class Account {
  final String id;
  final String userId;
  final String name;
  final AccountType type;
  final double balance;
  final String icon;
  final String color;
  final String? note;
  final int sortOrder;
  final bool isIncludedInTotal;
}

enum AccountType { cash, debitCard, creditCard, alipay, wechat, other }
```

#### 2.5 家庭模型 (Family)
```dart
class Family {
  final String id;
  final String name;
  final String? description;
  final String createdBy;
  final String inviteCode;        // 邀请码
  final DateTime createdAt;
  final DateTime updatedAt;
}
```

#### 2.6 家庭成员模型 (FamilyMember)
```dart
class FamilyMember {
  final String id;
  final String familyId;
  final String userId;
  final FamilyRole role;          // 角色：创建者/管理员/成员
  final String? nickname;         // 在家庭中的昵称
  final DateTime joinedAt;
}

enum FamilyRole { owner, admin, member }
```

#### 2.7 预算模型 (Budget)
```dart
class Budget {
  final String id;
  final String userId;
  final String? familyId;         // 家庭预算
  final double amount;
  final BudgetPeriod period;      // 月度/年度
  final String? categoryId;       // 特定分类预算（null为总预算）
  final DateTime startDate;
  final DateTime? endDate;
  final bool isActive;
}

enum BudgetPeriod { monthly, yearly }
```

### 阶段三：本地数据库设计

#### 3.1 SQLite 表结构

**users 表**
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  email TEXT,
  avatar TEXT,
  phone TEXT,
  current_family_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**transactions 表**
```sql
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  family_id TEXT,
  type INTEGER NOT NULL,  -- 0: expense, 1: income
  amount REAL NOT NULL,
  category_id TEXT NOT NULL,
  sub_category_id TEXT,
  account_id TEXT NOT NULL,
  date INTEGER NOT NULL,
  note TEXT,
  tags TEXT,
  location TEXT,
  is_family_shared INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  is_synced INTEGER DEFAULT 0
);
```

**categories 表**
```sql
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  family_id TEXT,
  name TEXT NOT NULL,
  type INTEGER NOT NULL,  -- 0: expense, 1: income
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_default INTEGER DEFAULT 0,
  is_family_shared INTEGER DEFAULT 0
);
```

**accounts 表**
```sql
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type INTEGER NOT NULL,
  balance REAL DEFAULT 0,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  note TEXT,
  sort_order INTEGER DEFAULT 0,
  is_included_in_total INTEGER DEFAULT 1
);
```

**families 表**
```sql
CREATE TABLE families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**family_members 表**
```sql
CREATE TABLE family_members (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role INTEGER NOT NULL,  -- 0: owner, 1: admin, 2: member
  nickname TEXT,
  joined_at INTEGER NOT NULL,
  UNIQUE(family_id, user_id)
);
```

**budgets 表**
```sql
CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  family_id TEXT,
  amount REAL NOT NULL,
  period INTEGER NOT NULL,  -- 0: monthly, 1: yearly
  category_id TEXT,
  start_date INTEGER NOT NULL,
  end_date INTEGER,
  is_active INTEGER DEFAULT 1
);
```

### 阶段四：核心页面开发

#### 4.1 启动页 (SplashPage)
- 检查登录状态
- 初始化数据库
- 加载本地配置
- 跳转到首页或登录页

#### 4.2 登录/注册页
- 邮箱/手机号登录
- 注册新账号
- 第三方登录（微信、Apple）

#### 4.3 首页 (HomePage)
- **顶部卡片**: 本月收入、支出、结余
- **预算进度**: 本月预算使用情况
- **快速记账**: 悬浮按钮
- **最近账单**: 最近5-10条记录
- **切换账本**: 个人/家庭切换按钮

#### 4.4 记账页 (AddTransactionPage)
- **金额输入**: 数字键盘
- **类型切换**: 收入/支出
- **分类选择**: 网格展示分类图标
- **账户选择**: 下拉选择
- **日期选择**: 日期时间选择器
- **备注输入**: 文本框
- **家庭共享开关**: 是否计入家庭账本

#### 4.5 账单列表页 (TransactionListPage)
- **筛选器**: 时间范围、分类、账户、类型
- **列表展示**: 按日期分组
- **操作**: 编辑、删除
- **批量操作**: 多选删除

#### 4.6 统计页 (StatisticsPage)
- **时间维度**: 周/月/年/自定义
- **趋势图**: 收支折线图
- **分类占比**: 饼图/环形图
- **排行榜**: 支出最多的分类TOP5
- **对比分析**: 本月vs上月

#### 4.7 家庭管理页 (FamilyPage)
- **创建家庭**: 输入名称、描述
- **加入家庭**: 输入邀请码
- **家庭列表**: 展示已加入的家庭
- **成员管理**: 查看成员、移除成员（管理员）
- **家庭账单**: 查看家庭总账单

#### 4.8 个人中心页 (ProfilePage)
- **用户信息**: 头像、昵称
- **账户管理**: 添加/编辑账户
- **分类管理**: 自定义分类
- **预算设置**: 设置月度/年度预算
- **数据管理**: 备份、导出、导入
- **设置**: 主题、语言、通知

### 阶段五：状态管理 (Cubit)

Cubit 是 BLoC 的简化版本，不需要定义 Event，直接通过方法调用来触发状态变更，代码更简洁。

#### 5.1 认证 Cubit (AuthCubit)

**文件**: `lib/features/auth/cubit/auth_cubit.dart`

```dart
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ledger_app/models/user.dart';
import 'package:ledger_app/repositories/auth_repository.dart';

part 'auth_state.dart';

class AuthCubit extends Cubit<AuthState> {
  final AuthRepository _authRepository;

  AuthCubit(this._authRepository) : super(const AuthInitial());

  /// 检查登录状态
  Future<void> checkAuth() async {
    emit(const AuthLoading());
    try {
      final user = await _authRepository.getCurrentUser();
      if (user != null) {
        emit(AuthAuthenticated(user));
      } else {
        emit(const AuthUnauthenticated());
      }
    } catch (e) {
      emit(AuthError(e.toString()));
    }
  }

  /// 登录
  Future<void> login(String email, String password) async {
    emit(const AuthLoading());
    try {
      final user = await _authRepository.login(email, password);
      emit(AuthAuthenticated(user));
    } catch (e) {
      emit(AuthError(e.toString()));
    }
  }

  /// 注册
  Future<void> register(String username, String email, String password) async {
    emit(const AuthLoading());
    try {
      final user = await _authRepository.register(username, email, password);
      emit(AuthAuthenticated(user));
    } catch (e) {
      emit(AuthError(e.toString()));
    }
  }

  /// 登出
  Future<void> logout() async {
    emit(const AuthLoading());
    await _authRepository.logout();
    emit(const AuthUnauthenticated());
  }
}
```

**文件**: `lib/features/auth/cubit/auth_state.dart`

```dart
part of 'auth_cubit.dart';

abstract class AuthState {
  const AuthState();
}

class AuthInitial extends AuthState {
  const AuthInitial();
}

class AuthLoading extends AuthState {
  const AuthLoading();
}

class AuthAuthenticated extends AuthState {
  final User user;
  const AuthAuthenticated(this.user);
}

class AuthUnauthenticated extends AuthState {
  const AuthUnauthenticated();
}

class AuthError extends AuthState {
  final String message;
  const AuthError(this.message);
}
```

#### 5.2 首页 Cubit (HomeCubit)

**文件**: `lib/features/home/cubit/home_cubit.dart`

```dart
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ledger_app/models/transaction.dart';
import 'package:ledger_app/models/family.dart';
import 'package:ledger_app/repositories/transaction_repository.dart';
import 'package:ledger_app/repositories/family_repository.dart';

part 'home_state.dart';

class HomeCubit extends Cubit<HomeState> {
  final TransactionRepository _transactionRepository;
  final FamilyRepository _familyRepository;

  HomeCubit(
    this._transactionRepository,
    this._familyRepository,
  ) : super(const HomeInitial());

  /// 加载首页数据
  Future<void> loadHomeData() async {
    emit(const HomeLoading());
    try {
      final now = DateTime.now();
      final startOfMonth = DateTime(now.year, now.month, 1);
      final endOfMonth = DateTime(now.year, now.month + 1, 0);

      // 获取本月收支统计
      final summary = await _transactionRepository.getMonthlySummary(
        startOfMonth,
        endOfMonth,
      );

      // 获取最近账单
      final recentTransactions = await _transactionRepository.getRecent(10);

      // 获取当前家庭
      final currentFamily = await _familyRepository.getCurrentFamily();

      // 获取预算进度
      final budgetProgress = await _transactionRepository.getBudgetProgress(
        startOfMonth,
        endOfMonth,
      );

      emit(HomeLoaded(
        income: summary['income'] ?? 0,
        expense: summary['expense'] ?? 0,
        balance: (summary['income'] ?? 0) - (summary['expense'] ?? 0),
        recentTransactions: recentTransactions,
        currentFamily: currentFamily,
        budgetProgress: budgetProgress,
      ));
    } catch (e) {
      emit(HomeError(e.toString()));
    }
  }

  /// 切换账本（个人/家庭）
  Future<void> switchLedger(String? familyId) async {
    await _familyRepository.setCurrentFamily(familyId);
    await loadHomeData();
  }
}
```

**文件**: `lib/features/home/cubit/home_state.dart`

```dart
part of 'home_cubit.dart';

abstract class HomeState {
  const HomeState();
}

class HomeInitial extends HomeState {
  const HomeInitial();
}

class HomeLoading extends HomeState {
  const HomeLoading();
}

class HomeLoaded extends HomeState {
  final double income;
  final double expense;
  final double balance;
  final List<Transaction> recentTransactions;
  final Family? currentFamily;
  final double budgetProgress;

  const HomeLoaded({
    required this.income,
    required this.expense,
    required this.balance,
    required this.recentTransactions,
    this.currentFamily,
    required this.budgetProgress,
  });
}

class HomeError extends HomeState {
  final String message;
  const HomeError(this.message);
}
```

#### 5.3 记账 Cubit (AddTransactionCubit)

**文件**: `lib/features/transaction/cubit/add_transaction_cubit.dart`

```dart
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ledger_app/models/category.dart';
import 'package:ledger_app/models/account.dart';
import 'package:ledger_app/models/transaction.dart';
import 'package:ledger_app/repositories/transaction_repository.dart';
import 'package:ledger_app/repositories/category_repository.dart';
import 'package:ledger_app/repositories/account_repository.dart';

part 'add_transaction_state.dart';

class AddTransactionCubit extends Cubit<AddTransactionState> {
  final TransactionRepository _transactionRepository;
  final CategoryRepository _categoryRepository;
  final AccountRepository _accountRepository;

  AddTransactionCubit(
    this._transactionRepository,
    this._categoryRepository,
    this._accountRepository,
  ) : super(const AddTransactionInitial());

  /// 加载分类和账户
  Future<void> loadFormData() async {
    emit(const AddTransactionLoading());
    try {
      final categories = await _categoryRepository.getAll();
      final accounts = await _accountRepository.getAll();
      emit(AddTransactionFormDataLoaded(
        categories: categories,
        accounts: accounts,
      ));
    } catch (e) {
      emit(AddTransactionError(e.toString()));
    }
  }

  /// 保存账单
  Future<void> saveTransaction({
    required TransactionType type,
    required double amount,
    required String categoryId,
    required String accountId,
    required DateTime date,
    String? note,
    bool isFamilyShared = false,
  }) async {
    emit(const AddTransactionSaving());
    try {
      final transaction = Transaction(
        id: '', // 由数据库生成
        userId: '', // 从当前用户获取
        familyId: isFamilyShared ? null : null, // 根据当前家庭设置
        type: type,
        amount: amount,
        categoryId: categoryId,
        accountId: accountId,
        date: date,
        note: note,
        isFamilyShared: isFamilyShared,
        createdAt: DateTime.now(),
        updatedAt: DateTime.now(),
        isSynced: false,
      );

      await _transactionRepository.create(transaction);
      emit(const AddTransactionSuccess());
    } catch (e) {
      emit(AddTransactionError(e.toString()));
    }
  }
}
```

**文件**: `lib/features/transaction/cubit/add_transaction_state.dart`

```dart
part of 'add_transaction_cubit.dart';

abstract class AddTransactionState {
  const AddTransactionState();
}

class AddTransactionInitial extends AddTransactionState {
  const AddTransactionInitial();
}

class AddTransactionLoading extends AddTransactionState {
  const AddTransactionLoading();
}

class AddTransactionFormDataLoaded extends AddTransactionState {
  final List<Category> categories;
  final List<Account> accounts;

  const AddTransactionFormDataLoaded({
    required this.categories,
    required this.accounts,
  });
}

class AddTransactionSaving extends AddTransactionState {
  const AddTransactionSaving();
}

class AddTransactionSuccess extends AddTransactionState {
  const AddTransactionSuccess();
}

class AddTransactionError extends AddTransactionState {
  final String message;
  const AddTransactionError(this.message);
}
```

#### 5.4 家庭 Cubit (FamilyCubit)

**文件**: `lib/features/family/cubit/family_cubit.dart`

```dart
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ledger_app/models/family.dart';
import 'package:ledger_app/repositories/family_repository.dart';

part 'family_state.dart';

class FamilyCubit extends Cubit<FamilyState> {
  final FamilyRepository _familyRepository;

  FamilyCubit(this._familyRepository) : super(const FamilyInitial());

  /// 加载家庭列表
  Future<void> loadFamilies() async {
    emit(const FamilyLoading());
    try {
      final families = await _familyRepository.getMyFamilies();
      emit(FamilyListLoaded(families));
    } catch (e) {
      emit(FamilyError(e.toString()));
    }
  }

  /// 创建家庭
  Future<void> createFamily(String name, String? description) async {
    emit(const FamilyLoading());
    try {
      final family = await _familyRepository.create(name, description);
      emit(FamilyCreated(family));
      await loadFamilies();
    } catch (e) {
      emit(FamilyError(e.toString()));
    }
  }

  /// 加入家庭
  Future<void> joinFamily(String inviteCode) async {
    emit(const FamilyLoading());
    try {
      final family = await _familyRepository.joinByInviteCode(inviteCode);
      emit(FamilyJoined(family));
      await loadFamilies();
    } catch (e) {
      emit(FamilyError(e.toString()));
    }
  }

  /// 退出家庭
  Future<void> leaveFamily(String familyId) async {
    emit(const FamilyLoading());
    try {
      await _familyRepository.leaveFamily(familyId);
      emit(const FamilyLeft());
      await loadFamilies();
    } catch (e) {
      emit(FamilyError(e.toString()));
    }
  }
}
```

**文件**: `lib/features/family/cubit/family_state.dart`

```dart
part of 'family_cubit.dart';

abstract class FamilyState {
  const FamilyState();
}

class FamilyInitial extends FamilyState {
  const FamilyInitial();
}

class FamilyLoading extends FamilyState {
  const FamilyLoading();
}

class FamilyListLoaded extends FamilyState {
  final List<Family> families;
  const FamilyListLoaded(this.families);
}

class FamilyCreated extends FamilyState {
  final Family family;
  const FamilyCreated(this.family);
}

class FamilyJoined extends FamilyState {
  final Family family;
  const FamilyJoined(this.family);
}

class FamilyLeft extends FamilyState {
  const FamilyLeft();
}

class FamilyError extends FamilyState {
  final String message;
  const FamilyError(this.message);
}
```

#### 5.5 家庭账单 Cubit (FamilyTransactionsCubit)

**文件**: `lib/features/family/cubit/family_transactions_cubit.dart`

```dart
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ledger_app/models/transaction.dart';
import 'package:ledger_app/models/family_member.dart';
import 'package:ledger_app/repositories/family_repository.dart';

part 'family_transactions_state.dart';

class FamilyTransactionsCubit extends Cubit<FamilyTransactionsState> {
  final FamilyRepository _familyRepository;

  FamilyTransactionsCubit(this._familyRepository) 
    : super(const FamilyTransactionsInitial());

  /// 加载家庭账单
  Future<void> loadFamilyTransactions(String familyId, {
    DateTime? startDate,
    DateTime? endDate,
    String? memberId,
  }) async {
    emit(const FamilyTransactionsLoading());
    try {
      // 获取家庭成员
      final members = await _familyRepository.getMembers(familyId);
      
      // 获取家庭账单
      final transactions = await _familyRepository.getTransactions(
        familyId,
        startDate: startDate,
        endDate: endDate,
        memberId: memberId,
      );

      // 计算汇总
      double totalIncome = 0;
      double totalExpense = 0;
      for (final t in transactions) {
        if (t.type == TransactionType.income) {
          totalIncome += t.amount;
        } else {
          totalExpense += t.amount;
        }
      }

      emit(FamilyTransactionsLoaded(
        transactions: transactions,
        members: members,
        totalIncome: totalIncome,
        totalExpense: totalExpense,
        balance: totalIncome - totalExpense,
      ));
    } catch (e) {
      emit(FamilyTransactionsError(e.toString()));
    }
  }
}
```

**文件**: `lib/features/family/cubit/family_transactions_state.dart`

```dart
part of 'family_transactions_cubit.dart';

abstract class FamilyTransactionsState {
  const FamilyTransactionsState();
}

class FamilyTransactionsInitial extends FamilyTransactionsState {
  const FamilyTransactionsInitial();
}

class FamilyTransactionsLoading extends FamilyTransactionsState {
  const FamilyTransactionsLoading();
}

class FamilyTransactionsLoaded extends FamilyTransactionsState {
  final List<Transaction> transactions;
  final List<FamilyMember> members;
  final double totalIncome;
  final double totalExpense;
  final double balance;

  const FamilyTransactionsLoaded({
    required this.transactions,
    required this.members,
    required this.totalIncome,
    required this.totalExpense,
    required this.balance,
  });
}

class FamilyTransactionsError extends FamilyTransactionsState {
  final String message;
  const FamilyTransactionsError(this.message);
}
```

#### 5.6 Cubit 使用示例

在页面中使用 Cubit：

```dart
// lib/features/home/view/home_page.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ledger_app/features/home/cubit/home_cubit.dart';

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => getIt<HomeCubit>()..loadHomeData(),
      child: const _HomeView(),
    );
  }
}

class _HomeView extends StatelessWidget {
  const _HomeView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('首页')),
      body: BlocBuilder<HomeCubit, HomeState>(
        builder: (context, state) {
          if (state is HomeLoading) {
            return const Center(child: CircularProgressIndicator());
          }
          
          if (state is HomeLoaded) {
            return Column(
              children: [
                // 收支概览卡片
                SummaryCard(
                  income: state.income,
                  expense: state.expense,
                  balance: state.balance,
                ),
                // 账本切换
                LedgerSwitcher(
                  currentFamily: state.currentFamily,
                  onSwitch: (familyId) {
                    context.read<HomeCubit>().switchLedger(familyId);
                  },
                ),
                // 最近账单
                RecentTransactions(
                  transactions: state.recentTransactions,
                ),
              ],
            );
          }
          
          if (state is HomeError) {
            return ErrorRetry(message: state.message);
          }
          
          return const SizedBox.shrink();
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          // 跳转到记账页面
        },
        child: const Icon(Icons.add),
      ),
    );
  }
}
```

### 阶段六：数据同步策略

#### 6.1 同步机制
- **离线优先**: 所有操作先写入本地数据库
- **后台同步**: 网络恢复时自动同步未同步数据
- **冲突解决**: 以服务器数据为准，本地保留副本

#### 6.2 同步流程
```
1. 用户操作 -> 写入本地数据库 (is_synced = 0)
2. 检测网络状态
3. 网络可用 -> 发送到服务器
4. 服务器返回成功 -> 更新 is_synced = 1
5. 服务器返回失败 -> 标记错误，稍后重试
```

---

## 第二部分：Node.js 后端开发计划

### 技术栈选择

| 组件 | 技术 | 说明 |
|------|------|------|
| 框架 | NestJS | 企业级 TypeScript 框架，支持模块化、依赖注入 |
| 数据库 | PostgreSQL | 关系型数据库，支持复杂查询 |
| 缓存 | Redis | 会话缓存、邀请码缓存 |
| ORM | Prisma | 现代化的 TypeScript ORM |
| 认证 | JWT + Passport | 无状态认证 |
| API | RESTful + WebSocket | 实时通知 |
| 文档 | Swagger | API 文档自动生成 |
| 测试 | Jest | 单元测试和集成测试 |
| 部署 | Docker + Docker Compose | 容器化部署 |

### 项目结构

```
ledger-api/
├── src/
│   ├── main.ts                    # 应用入口
│   ├── app.module.ts              # 根模块
│   ├── config/
│   │   ├── database.config.ts
│   │   ├── redis.config.ts
│   │   ├── jwt.config.ts
│   │   └── app.config.ts
│   ├── common/
│   │   ├── decorators/
│   │   ├── filters/
│   │   ├── guards/
│   │   ├── interceptors/
│   │   ├── pipes/
│   │   └── utils/
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.module.ts
│   │   │   ├── dto/
│   │   │   └── strategies/
│   │   ├── users/
│   │   │   ├── users.controller.ts
│   │   │   ├── users.service.ts
│   │   │   ├── users.module.ts
│   │   │   └── dto/
│   │   ├── transactions/
│   │   │   ├── transactions.controller.ts
│   │   │   ├── transactions.service.ts
│   │   │   ├── transactions.module.ts
│   │   │   └── dto/
│   │   ├── categories/
│   │   ├── accounts/
│   │   ├── families/
│   │   ├── budgets/
│   │   └── sync/
│   └── prisma/
│       ├── schema.prisma
│       └── migrations/
├── test/
├── docker-compose.yml
├── Dockerfile
├── nest-cli.json
├── package.json
└── tsconfig.json
```

### 数据库设计 (Prisma Schema)

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String    @id @default(uuid())
  username      String    @unique
  email         String    @unique
  password      String    // 加密存储
  avatar        String?
  phone         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  // 关联
  transactions  Transaction[]
  accounts      Account[]
  categories    Category[]
  budgets       Budget[]
  familyMembers FamilyMember[]
  createdFamilies Family[] @relation("FamilyCreator")
  
  @@map("users")
}

model Transaction {
  id              String          @id @default(uuid())
  userId          String
  familyId        String?
  type            TransactionType
  amount          Decimal         @db.Decimal(15, 2)
  categoryId      String
  subCategoryId   String?
  accountId       String
  date            DateTime
  note            String?
  tags            String[]
  location        String?
  isFamilyShared  Boolean         @default(false)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  deletedAt       DateTime?
  
  // 关联
  user            User            @relation(fields: [userId], references: [id])
  family          Family?         @relation(fields: [familyId], references: [id])
  category        Category        @relation(fields: [categoryId], references: [id])
  account         Account         @relation(fields: [accountId], references: [id])
  
  @@index([userId, date])
  @@index([familyId, date])
  @@map("transactions")
}

model Category {
  id              String          @id @default(uuid())
  userId          String
  familyId        String?
  name            String
  type            TransactionType
  icon            String
  color           String
  sortOrder       Int             @default(0)
  isDefault       Boolean         @default(false)
  isFamilyShared  Boolean         @default(false)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  
  // 关联
  user            User            @relation(fields: [userId], references: [id])
  family          Family?         @relation(fields: [familyId], references: [id])
  transactions    Transaction[]
  
  @@map("categories")
}

model Account {
  id                String    @id @default(uuid())
  userId            String
  name              String
  type              AccountType
  balance           Decimal   @db.Decimal(15, 2) @default(0)
  icon              String
  color             String
  note              String?
  sortOrder         Int       @default(0)
  isIncludedInTotal Boolean   @default(true)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  
  // 关联
  user              User      @relation(fields: [userId], references: [id])
  transactions      Transaction[]
  
  @@map("accounts")
}

model Family {
  id            String          @id @default(uuid())
  name          String
  description   String?
  createdBy     String
  inviteCode    String          @unique
  inviteCodeExpiresAt DateTime?
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
  
  // 关联
  creator       User            @relation("FamilyCreator", fields: [createdBy], references: [id])
  members       FamilyMember[]
  transactions  Transaction[]
  categories    Category[]
  budgets       Budget[]
  
  @@map("families")
}

model FamilyMember {
  id        String      @id @default(uuid())
  familyId  String
  userId    String
  role      FamilyRole  @default(member)
  nickname  String?
  joinedAt  DateTime    @default(now())
  
  // 关联
  family    Family      @relation(fields: [familyId], references: [id], onDelete: Cascade)
  user      User        @relation(fields: [userId], references: [id])
  
  @@unique([familyId, userId])
  @@map("family_members")
}

model Budget {
  id          String        @id @default(uuid())
  userId      String
  familyId    String?
  amount      Decimal       @db.Decimal(15, 2)
  period      BudgetPeriod
  categoryId  String?
  startDate   DateTime
  endDate     DateTime?
  isActive    Boolean       @default(true)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  
  // 关联
  user        User          @relation(fields: [userId], references: [id])
  family      Family?       @relation(fields: [familyId], references: [id])
  
  @@map("budgets")
}

model SyncLog {
  id          String    @id @default(uuid())
  userId      String
  deviceId    String
  lastSyncAt  DateTime
  createdAt   DateTime  @default(now())
  
  @@unique([userId, deviceId])
  @@map("sync_logs")
}

enum TransactionType {
  expense
  income
}

enum AccountType {
  cash
  debitCard
  creditCard
  alipay
  wechat
  other
}

enum FamilyRole {
  owner
  admin
  member
}

enum BudgetPeriod {
  monthly
  yearly
}
```

### API 接口设计

#### 认证模块 (Auth)
```
POST   /api/auth/register          # 注册
POST   /api/auth/login             # 登录
POST   /api/auth/logout            # 登出
POST   /api/auth/refresh           # 刷新 Token
POST   /api/auth/forgot-password   # 忘记密码
POST   /api/auth/reset-password    # 重置密码
```

#### 用户模块 (Users)
```
GET    /api/users/me               # 获取当前用户信息
PUT    /api/users/me               # 更新用户信息
PUT    /api/users/me/avatar        # 上传头像
DELETE /api/users/me               # 注销账号
```

#### 账单模块 (Transactions)
```
GET    /api/transactions           # 获取账单列表
POST   /api/transactions           # 创建账单
GET    /api/transactions/:id       # 获取账单详情
PUT    /api/transactions/:id       # 更新账单
DELETE /api/transactions/:id       # 删除账单
POST   /api/transactions/batch     # 批量操作
GET    /api/transactions/summary   # 收支汇总
```

#### 分类模块 (Categories)
```
GET    /api/categories             # 获取分类列表
POST   /api/categories             # 创建分类
PUT    /api/categories/:id         # 更新分类
DELETE /api/categories/:id         # 删除分类
PUT    /api/categories/reorder     # 排序
```

#### 账户模块 (Accounts)
```
GET    /api/accounts               # 获取账户列表
POST   /api/accounts               # 创建账户
PUT    /api/accounts/:id           # 更新账户
DELETE /api/accounts/:id           # 删除账户
POST   /api/accounts/:id/transfer  # 账户转账
```

#### 家庭模块 (Families)
```
GET    /api/families               # 获取家庭列表
POST   /api/families               # 创建家庭
GET    /api/families/:id           # 获取家庭详情
PUT    /api/families/:id           # 更新家庭信息
DELETE /api/families/:id           # 解散家庭
POST   /api/families/:id/leave     # 退出家庭

POST   /api/families/join          # 加入家庭（通过邀请码）
POST   /api/families/:id/invite    # 生成邀请码
DELETE /api/families/:id/members/:userId  # 移除成员
PUT    /api/families/:id/members/:userId/role  # 修改成员角色

GET    /api/families/:id/transactions  # 获取家庭账单
GET    /api/families/:id/summary       # 家庭收支汇总
GET    /api/families/:id/statistics    # 家庭统计
```

#### 预算模块 (Budgets)
```
GET    /api/budgets                # 获取预算列表
POST   /api/budgets                # 创建预算
PUT    /api/budgets/:id            # 更新预算
DELETE /api/budgets/:id            # 删除预算
GET    /api/budgets/:id/progress   # 获取预算进度
```

#### 同步模块 (Sync)
```
POST   /api/sync/pull              # 拉取服务器数据
POST   /api/sync/push              # 推送本地数据
POST   /api/sync/conflicts         # 获取冲突数据
POST   /api/sync/resolve           # 解决冲突
```

### 核心业务逻辑

#### 1. 家庭创建与加入流程
```
创建家庭:
1. 用户 POST /api/families { name, description }
2. 后端生成唯一 inviteCode (6位字母数字)
3. 创建家庭记录，创建者为 owner
4. 返回家庭信息和邀请码

加入家庭:
1. 用户 POST /api/families/join { inviteCode }
2. 后端验证邀请码是否有效
3. 检查用户是否已在家庭中
4. 创建 family_members 记录，role = member
5. 返回家庭信息
```

#### 2. 家庭账单权限控制
```
查看家庭账单:
- 用户必须是家庭成员
- 返回 isFamilyShared = true 的账单

家庭统计:
- 汇总所有家庭成员的共享账单
- 支持按成员、分类、时间筛选
```

#### 3. 邀请码机制
```
生成规则:
- 6位字母数字组合 (如: A3B9K2)
- 存储在 Redis，TTL = 7天
- 过期后自动重新生成

验证规则:
- 检查 Redis 是否存在
- 检查是否过期
- 检查用户是否已在家庭中
```

#### 4. 数据同步策略
```
推送流程 (Push):
1. 客户端发送未同步数据
2. 服务器验证数据权限
3. 批量插入/更新数据库
4. 返回同步成功的 ID 列表
5. 更新 sync_logs

拉取流程 (Pull):
1. 客户端发送 lastSyncAt
2. 服务器查询该时间之后的数据
3. 返回新增、修改、删除的数据
4. 客户端合并到本地

冲突解决:
- 以服务器数据为准
- 客户端保留副本供用户确认
```

### 安全设计

#### 1. 认证与授权
- JWT Token 认证 (Access Token + Refresh Token)
- Token 过期时间：Access 15分钟，Refresh 7天
- 敏感操作需要重新验证密码

#### 2. 数据权限
- 用户只能访问自己的数据
- 家庭数据需要验证成员身份
- 角色权限控制 (owner > admin > member)

#### 3. 输入验证
- 使用 class-validator 验证 DTO
- SQL 注入防护 (Prisma 自动处理)
- XSS 防护

#### 4. 密码安全
- bcrypt 加密存储
- 密码强度要求
- 登录失败限制 (5次/15分钟)

### 部署方案

#### Docker Compose 配置
```yaml
# docker-compose.yml
version: '3.8'
services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://user:pass@postgres:5432/ledger
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis
  
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: ledger
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

---

## 开发里程碑

### 第一阶段：MVP (4-6周)
**前端:**
- [x] 项目基础搭建
- [x] 本地数据库
- [x] 记账功能（金额、分类、日期）
- [x] 账单列表
- [x] 简单统计

**后端:**
- [x] 项目基础搭建
- [x] 用户认证
- [x] 账单 CRUD
- [x] 基础 API

### 第二阶段：家庭账本 (2-3周)
**前端:**
- [ ] 家庭管理页面
- [ ] 家庭账单查看
- [ ] 家庭共享开关

**后端:**
- [ ] 家庭模块
- [ ] 邀请码机制
- [ ] 权限控制

### 第三阶段：数据同步 (2-3周)
**前端:**
- [ ] 网络状态检测
- [ ] 同步机制
- [ ] 冲突处理

**后端:**
- [ ] 同步 API
- [ ] 冲突检测

### 第四阶段：高级功能 (2-3周)
**前端:**
- [ ] 图表统计
- [ ] 预算管理
- [ ] 数据导出

**后端:**
- [ ] 统计 API
- [ ] 预算模块
- [ ] 文件导出

---

## 附录

### 命名规范
- 数据库表：snake_case，复数形式
- 模型类：PascalCase，单数形式
- API 端点：kebab-case
- 文件命名：snake_case

### 错误码定义
```typescript
enum ErrorCode {
  // 通用错误 1000-1099
  UNKNOWN_ERROR = 1000,
  VALIDATION_ERROR = 1001,
  UNAUTHORIZED = 1002,
  FORBIDDEN = 1003,
  NOT_FOUND = 1004,
  
  // 认证错误 1100-1199
  INVALID_CREDENTIALS = 1100,
  TOKEN_EXPIRED = 1101,
  TOKEN_INVALID = 1102,
  
  // 业务错误 1200-1299
  FAMILY_NOT_FOUND = 1200,
  INVALID_INVITE_CODE = 1201,
  ALREADY_IN_FAMILY = 1202,
  INSUFFICIENT_PERMISSIONS = 1203,
}
```

### 响应格式
```typescript
// 成功响应
{
  "code": 0,
  "message": "success",
  "data": { ... }
}

// 错误响应
{
  "code": 1001,
  "message": "Validation failed",
  "errors": [ ... ]
}

// 分页响应
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [ ... ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 100,
      "totalPages": 5
    }
  }
}
```
