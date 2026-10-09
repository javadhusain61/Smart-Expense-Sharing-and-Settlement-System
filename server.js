const express = require("express");
const cors = require("cors");
const path = require("path");
const mysql = require("mysql2");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ===============================
// MySQL CONNECTION
// ===============================

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "Javad@429",
    database: "smart_expense_sharing"
});

db.connect((err) => {
    if (err) {
        console.log("MySQL connection failed:", err.message);
        return;
    }

    console.log("MySQL connected successfully!");
});


// ===============================
// REGISTER
// ===============================

app.post("/register", (req, res) => {

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({
            message: "Please fill all fields"
        });
    }

    const sql = `
        INSERT INTO users (name, email, password)
        VALUES (?, ?, ?)
    `;

    db.query(sql, [name, email, password], (err, result) => {

        if (err) {
            console.log(err);

            if (err.code === "ER_DUP_ENTRY") {
                return res.status(409).json({
                    message: "Email already registered"
                });
            }

            return res.status(500).json({
                message: "Registration failed"
            });
        }

        res.json({
            message: "Registration successful!",
            user_id: result.insertId
        });
    });
});


// ===============================
// LOGIN
// ===============================

app.post("/login", (req, res) => {

    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            message: "Please enter email and password"
        });
    }

    const sql = `
        SELECT user_id, name, email
        FROM users
        WHERE email = ? AND password = ?
    `;

    db.query(sql, [email, password], (err, results) => {

        if (err) {
            console.log(err);

            return res.status(500).json({
                message: "Login failed"
            });
        }

        if (results.length === 0) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        res.json({
            message: "Login successful!",
            user: results[0]
        });
    });
});


// ===============================
// CREATE GROUP
// ===============================

app.post("/create-group", (req, res) => {

    const { group_name, created_by } = req.body;

    if (!group_name || !created_by) {
        return res.status(400).json({
            message: "Please enter group name"
        });
    }

    const groupSql = `
        INSERT INTO expense_groups (group_name, created_by)
        VALUES (?, ?)
    `;

    db.query(
        groupSql,
        [group_name, created_by],
        (err, result) => {

            if (err) {
                console.log(err);

                return res.status(500).json({
                    message: "Group creation failed"
                });
            }

            const groupId = result.insertId;

            // Automatically add creator as group member
            const memberSql = `
                INSERT INTO group_members (group_id, user_id)
                VALUES (?, ?)
            `;

            db.query(
                memberSql,
                [groupId, created_by],
                (memberErr) => {

                    if (memberErr) {
                        console.log(memberErr);

                        return res.status(500).json({
                            message:
                                "Group created but creator could not be added"
                        });
                    }

                    res.json({
                        message: "Group created successfully!",
                        group_id: groupId
                    });
                }
            );
        }
    );
});


// ===============================
// ADD MEMBER
// ===============================

app.post("/add-member", (req, res) => {

    const { group_id, user_id } = req.body;

    if (!group_id || !user_id) {
        return res.status(400).json({
            message: "Group ID and User ID are required"
        });
    }

    // Check group
    const groupSql = `
        SELECT group_id
        FROM expense_groups
        WHERE group_id = ?
    `;

    db.query(groupSql, [group_id], (groupErr, groupResult) => {

        if (groupErr) {
            console.log(groupErr);

            return res.status(500).json({
                message: "Unable to check group"
            });
        }

        if (groupResult.length === 0) {
            return res.status(404).json({
                message: "Group not found"
            });
        }

        // Check user
        const userSql = `
            SELECT user_id
            FROM users
            WHERE user_id = ?
        `;

        db.query(userSql, [user_id], (userErr, userResult) => {

            if (userErr) {
                console.log(userErr);

                return res.status(500).json({
                    message: "Unable to check user"
                });
            }

            if (userResult.length === 0) {
                return res.status(404).json({
                    message: "User not found"
                });
            }

            // Add member
            const sql = `
                INSERT INTO group_members (group_id, user_id)
                VALUES (?, ?)
            `;

            db.query(sql, [group_id, user_id], (err) => {

                if (err) {
                    console.log(err);

                    if (err.code === "ER_DUP_ENTRY") {
                        return res.status(409).json({
                            message:
                                "User is already a member of this group"
                        });
                    }

                    return res.status(500).json({
                        message: "Failed to add member"
                    });
                }

                res.json({
                    message: "Member added successfully!"
                });
            });
        });
    });
});


// ===============================
// ADD EXPENSE + AUTOMATIC SPLIT
// ===============================

app.post("/add-expense", (req, res) => {

    const {
        group_id,
        paid_by,
        description,
        amount
    } = req.body;

    if (
        !group_id ||
        !paid_by ||
        !description ||
        !amount
    ) {
        return res.status(400).json({
            message: "Please fill all fields"
        });
    }

    const numericAmount = Number(amount);

    if (
        Number.isNaN(numericAmount) ||
        numericAmount <= 0
    ) {
        return res.status(400).json({
            message: "Amount must be greater than 0"
        });
    }

    // Check payer is group member
    const payerSql = `
        SELECT user_id
        FROM group_members
        WHERE group_id = ? AND user_id = ?
    `;

    db.query(
        payerSql,
        [group_id, paid_by],
        (payerErr, payerResult) => {

            if (payerErr) {
                console.log(payerErr);

                return res.status(500).json({
                    message: "Unable to verify payer"
                });
            }

            if (payerResult.length === 0) {
                return res.status(400).json({
                    message:
                        "Paid by user is not a member of this group"
                });
            }

            // Get all group members
            const membersSql = `
                SELECT user_id
                FROM group_members
                WHERE group_id = ?
                ORDER BY user_id
            `;

            db.query(
                membersSql,
                [group_id],
                (membersErr, members) => {

                    if (membersErr) {
                        console.log(membersErr);

                        return res.status(500).json({
                            message:
                                "Unable to load group members"
                        });
                    }

                    if (members.length === 0) {
                        return res.status(400).json({
                            message:
                                "Group has no members"
                        });
                    }

                    // Insert expense
                    const expenseSql = `
                        INSERT INTO expenses
                        (group_id, paid_by, description, amount)
                        VALUES (?, ?, ?, ?)
                    `;

                    db.query(
                        expenseSql,
                        [
                            group_id,
                            paid_by,
                            description,
                            numericAmount
                        ],
                        (expenseErr, expenseResult) => {

                            if (expenseErr) {
                                console.log(expenseErr);

                                return res.status(500).json({
                                    message:
                                        "Expense could not be added"
                                });
                            }

                            const expenseId =
                                expenseResult.insertId;

                            const memberCount =
                                members.length;

                            const totalCents =
                                Math.round(
                                    numericAmount * 100
                                );

                            const baseCents =
                                Math.floor(
                                    totalCents /
                                    memberCount
                                );

                            const remainingCents =
                                totalCents -
                                (
                                    baseCents *
                                    memberCount
                                );

                            const splitValues =
                                members.map(
                                    (member, index) => {

                                        let shareCents =
                                            baseCents;

                                        if (
                                            index <
                                            remainingCents
                                        ) {
                                            shareCents += 1;
                                        }

                                        return [
                                            expenseId,
                                            member.user_id,
                                            (
                                                shareCents / 100
                                            ).toFixed(2)
                                        ];
                                    }
                                );

                            const splitSql = `
                                INSERT INTO expense_splits
                                (expense_id, user_id, share_amount)
                                VALUES ?
                            `;

                            db.query(
                                splitSql,
                                [splitValues],
                                (splitErr) => {

                                    if (splitErr) {
                                        console.log(splitErr);

                                        return res.status(500).json({
                                            message:
                                                "Expense added but split could not be created"
                                        });
                                    }

                                    res.json({
                                        message:
                                            `Expense added and split equally among ${memberCount} members!`,
                                        expense_id:
                                            expenseId
                                    });
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});


// ===============================
// GET EXPENSES
// ===============================

app.get("/expenses/:groupId", (req, res) => {

    const groupId = req.params.groupId;

    const sql = `
        SELECT
            expense_id,
            group_id,
            paid_by,
            description,
            amount,
            expense_date
        FROM expenses
        WHERE group_id = ?
        ORDER BY expense_date DESC
    `;

    db.query(sql, [groupId], (err, results) => {

        if (err) {
            console.log(err);

            return res.status(500).json({
                message: "Unable to load expenses"
            });
        }

        res.json(results);
    });
});


// ===============================
// SPLIT EXPENSE - OLD/PRACTICAL API
// ===============================

app.post("/split-expense", (req, res) => {

    const {
        expense_id,
        user_id,
        number_of_members
    } = req.body;

    if (
        !expense_id ||
        !user_id ||
        !number_of_members
    ) {
        return res.status(400).json({
            message: "Please fill all fields"
        });
    }

    const expenseSql = `
        SELECT amount
        FROM expenses
        WHERE expense_id = ?
    `;

    db.query(
        expenseSql,
        [expense_id],
        (err, results) => {

            if (err) {
                console.log(err);

                return res.status(500).json({
                    message: "Unable to find expense"
                });
            }

            if (results.length === 0) {
                return res.status(404).json({
                    message: "Expense not found"
                });
            }

            const total =
                Number(results[0].amount);

            const share =
                Number(
                    (
                        total /
                        number_of_members
                    ).toFixed(2)
                );

            const splitSql = `
                INSERT INTO expense_splits
                (expense_id, user_id, share_amount)
                VALUES (?, ?, ?)
            `;

            db.query(
                splitSql,
                [
                    expense_id,
                    user_id,
                    share
                ],
                (splitErr) => {

                    if (splitErr) {
                        console.log(splitErr);

                        return res.status(500).json({
                            message:
                                "Unable to save split"
                        });
                    }

                    res.json({
                        message:
                            "Expense split successfully!",
                        total: total,
                        members:
                            number_of_members,
                        share: share
                    });
                }
            );
        }
    );
});


// ===============================
// SETTLEMENT CALCULATION
// ===============================

app.get("/settlement/:groupId", (req, res) => {

    const groupId =
        Number(req.params.groupId);

    const expenseSql = `
        SELECT
            es.user_id,
            es.share_amount,
            e.paid_by
        FROM expense_splits es
        JOIN expenses e
            ON es.expense_id = e.expense_id
        WHERE e.group_id = ?
    `;

    db.query(
        expenseSql,
        [groupId],
        (err, rows) => {

            if (err) {
                console.log(err);

                return res.status(500).json({
                    message:
                        "Settlement calculation failed"
                });
            }

            const balances = {};

            rows.forEach((row) => {

                const userId =
                    Number(row.user_id);

                const paidBy =
                    Number(row.paid_by);

                const share =
                    Number(row.share_amount);

                if (!balances[userId]) {
                    balances[userId] = 0;
                }

                if (!balances[paidBy]) {
                    balances[paidBy] = 0;
                }

                balances[userId] -= share;
                balances[paidBy] += share;
            });

            // Get settled payments
            const settledSql = `
                SELECT
                    from_user_id,
                    to_user_id,
                    amount
                FROM settlements
                WHERE group_id = ?
            `;

            db.query(
                settledSql,
                [groupId],
                (settledErr, settledRows) => {

                    if (settledErr) {
                        console.log(settledErr);

                        return res.status(500).json({
                            message:
                                "Unable to load settled payments"
                        });
                    }

                    settledRows.forEach(
                        (payment) => {

                            const fromUser =
                                Number(
                                    payment.from_user_id
                                );

                            const toUser =
                                Number(
                                    payment.to_user_id
                                );

                            const paymentAmount =
                                Number(payment.amount);

                            if (!balances[fromUser]) {
                                balances[fromUser] = 0;
                            }

                            if (!balances[toUser]) {
                                balances[toUser] = 0;
                            }

                            balances[fromUser] +=
                                paymentAmount;

                            balances[toUser] -=
                                paymentAmount;
                        }
                    );

                    const creditors = [];
                    const debtors = [];

                    Object.keys(balances).forEach(
                        (userId) => {

                            const balance =
                                Number(
                                    balances[userId]
                                        .toFixed(2)
                                );

                            if (balance > 0.01) {
                                creditors.push({
                                    user_id:
                                        Number(userId),
                                    amount:
                                        balance
                                });
                            }

                            if (balance < -0.01) {
                                debtors.push({
                                    user_id:
                                        Number(userId),
                                    amount:
                                        Math.abs(balance)
                                });
                            }
                        }
                    );

                    const settlements = [];

                    let i = 0;
                    let j = 0;

                    while (
                        i < debtors.length &&
                        j < creditors.length
                    ) {

                        const paymentAmount =
                            Math.min(
                                debtors[i].amount,
                                creditors[j].amount
                            );

                        settlements.push({
                            from_user_id:
                                debtors[i].user_id,

                            to_user_id:
                                creditors[j].user_id,

                            amount:
                                Number(
                                    paymentAmount
                                        .toFixed(2)
                                )
                        });

                        debtors[i].amount -=
                            paymentAmount;

                        creditors[j].amount -=
                            paymentAmount;

                        if (
                            debtors[i].amount <
                            0.01
                        ) {
                            i++;
                        }

                        if (
                            creditors[j].amount <
                            0.01
                        ) {
                            j++;
                        }
                    }

                    res.json(settlements);
                }
            );
        }
    );
});


// ===============================
// DASHBOARD
// ===============================

app.get("/dashboard/:userId", (req, res) => {

    const userId =
        Number(req.params.userId);

    const groupsSql = `
        SELECT COUNT(*) AS total_groups
        FROM group_members
        WHERE user_id = ?
    `;

    const expensesSql = `
        SELECT
            COALESCE(
                SUM(e.amount),
                0
            ) AS total_expenses
        FROM expenses e
        JOIN group_members gm
            ON e.group_id = gm.group_id
        WHERE gm.user_id = ?
    `;

    const balanceSql = `
        SELECT
            COALESCE(
                SUM(
                    CASE
                        WHEN es.user_id = ?
                            THEN -es.share_amount

                        WHEN e.paid_by = ?
                            THEN es.share_amount

                        ELSE 0
                    END
                ),
                0
            ) AS balance
        FROM expense_splits es
        JOIN expenses e
            ON es.expense_id = e.expense_id
        JOIN group_members gm
            ON e.group_id = gm.group_id
        WHERE gm.user_id = ?
    `;

    const settledSql = `
        SELECT
            COALESCE(
                SUM(
                    CASE
                        WHEN from_user_id = ?
                            THEN amount

                        WHEN to_user_id = ?
                            THEN -amount

                        ELSE 0
                    END
                ),
                0
            ) AS settled_amount
        FROM settlements
        WHERE group_id IN (
            SELECT group_id
            FROM group_members
            WHERE user_id = ?
        )
    `;

    db.query(
        groupsSql,
        [userId],
        (groupErr, groupResult) => {

            if (groupErr) {
                console.log(groupErr);

                return res.status(500).json({
                    message:
                        "Unable to load groups"
                });
            }

            db.query(
                expensesSql,
                [userId],
                (expenseErr, expenseResult) => {

                    if (expenseErr) {
                        console.log(expenseErr);

                        return res.status(500).json({
                            message:
                                "Unable to load expenses"
                        });
                    }

                    db.query(
                        balanceSql,
                        [
                            userId,
                            userId,
                            userId
                        ],
                        (balanceErr, balanceResult) => {

                            if (balanceErr) {
                                console.log(balanceErr);

                                return res.status(500).json({
                                    message:
                                        "Unable to calculate balance"
                                });
                            }

                            db.query(
                                settledSql,
                                [
                                    userId,
                                    userId,
                                    userId
                                ],
                                (
                                    settledErr,
                                    settledResult
                                ) => {

                                    if (settledErr) {
                                        console.log(
                                            settledErr
                                        );

                                        return res.status(500).json({
                                            message:
                                                "Unable to calculate settlement"
                                        });
                                    }

                                    const balance =
                                        Number(
                                            balanceResult[0]
                                                .balance
                                        );

                                    const settled =
                                        Number(
                                            settledResult[0]
                                                .settled_amount
                                        );

                                    const finalBalance =
                                        balance +
                                        settled;

                                    res.json({
                                        total_groups:
                                            groupResult[0]
                                                .total_groups,

                                        total_expenses:
                                            expenseResult[0]
                                                .total_expenses,

                                        pending_amount:
                                            finalBalance < 0
                                                ? Math.abs(
                                                    finalBalance
                                                )
                                                : 0
                                    });
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});


// ===============================
// RECENT EXPENSES
// ===============================

app.get(
    "/recent-expenses/:userId",
    (req, res) => {

        const userId =
            Number(req.params.userId);

        const sql = `
            SELECT
                e.expense_id,
                e.description,
                e.amount,
                e.paid_by,
                e.expense_date,
                eg.group_name
            FROM expenses e
            JOIN group_members gm
                ON e.group_id = gm.group_id
            JOIN expense_groups eg
                ON e.group_id = eg.group_id
            WHERE gm.user_id = ?
            ORDER BY e.expense_date DESC
            LIMIT 5
        `;

        db.query(
            sql,
            [userId],
            (err, results) => {

                if (err) {
                    console.log(err);

                    return res.status(500).json({
                        message:
                            "Unable to load recent expenses"
                    });
                }

                res.json(results);
            }
        );
    }
);


// ===============================
// MARK PAYMENT AS PAID
// ===============================

app.post("/settle-payment", (req, res) => {

    const {
        group_id,
        from_user_id,
        to_user_id,
        amount
    } = req.body;

    if (
        !group_id ||
        !from_user_id ||
        !to_user_id ||
        !amount
    ) {
        return res.status(400).json({
            message:
                "Invalid settlement details"
        });
    }

    if (
        Number(from_user_id) ===
        Number(to_user_id)
    ) {
        return res.status(400).json({
            message:
                "Payer and receiver cannot be the same user"
        });
    }

    const sql = `
        INSERT INTO settlements
        (group_id, from_user_id, to_user_id, amount)
        VALUES (?, ?, ?, ?)
    `;

    db.query(
        sql,
        [
            group_id,
            from_user_id,
            to_user_id,
            amount
        ],
        (err) => {

            if (err) {
                console.log(err);

                return res.status(500).json({
                    message:
                        "Payment could not be recorded"
                });
            }

            res.json({
                message:
                    "Payment marked as settled successfully!"
            });
        }
    );
});


// ===============================
// MY GROUPS
// ===============================

app.get("/my-groups/:userId", (req, res) => {

    const userId =
        Number(req.params.userId);

    const sql = `
        SELECT
            eg.group_id,
            eg.group_name,
            eg.created_by
        FROM expense_groups eg
        JOIN group_members gm
            ON eg.group_id = gm.group_id
        WHERE gm.user_id = ?
        ORDER BY eg.group_id DESC
    `;

    db.query(
        sql,
        [userId],
        (err, results) => {

            if (err) {
                console.log(err);

                return res.status(500).json({
                    message:
                        "Unable to load groups"
                });
            }

            res.json(results);
        }
    );
});


// ===============================
// GROUP DETAILS
// ===============================

app.get(
    "/group-details/:groupId",
    (req, res) => {

        const groupId =
            Number(req.params.groupId);

        const sql = `
            SELECT
                group_id,
                group_name,
                created_by
            FROM expense_groups
            WHERE group_id = ?
        `;

        db.query(
            sql,
            [groupId],
            (err, results) => {

                if (err) {
                    console.log(err);

                    return res.status(500).json({
                        message:
                            "Unable to load group details"
                    });
                }

                if (results.length === 0) {
                    return res.status(404).json({
                        message:
                            "Group not found"
                    });
                }

                res.json({
                    group: results[0]
                });
            }
        );
    }
);


// ===============================
// GROUP MEMBERS
// ===============================

app.get(
    "/group-members/:groupId",
    (req, res) => {

        const groupId =
            Number(req.params.groupId);

        const sql = `
            SELECT
                u.user_id,
                u.name,
                u.email
            FROM group_members gm
            JOIN users u
                ON gm.user_id = u.user_id
            WHERE gm.group_id = ?
            ORDER BY u.user_id
        `;

        db.query(
            sql,
            [groupId],
            (err, results) => {

                if (err) {
                    console.log(err);

                    return res.status(500).json({
                        message:
                            "Unable to load group members"
                    });
                }

                res.json(results);
            }
        );
    }
);


// ===============================
// GROUP EXPENSES
// ===============================

app.get(
    "/group-expenses/:groupId",
    (req, res) => {

        const groupId =
            Number(req.params.groupId);

        const sql = `
            SELECT
                expense_id,
                paid_by,
                description,
                amount,
                expense_date
            FROM expenses
            WHERE group_id = ?
            ORDER BY expense_date DESC
        `;

        db.query(
            sql,
            [groupId],
            (err, results) => {

                if (err) {
                    console.log(err);

                    return res.status(500).json({
                        message:
                            "Unable to load group expenses"
                    });
                }

                res.json(results);
            }
        );
    }
);


// ===============================
// START SERVER
// ===============================

app.listen(3000, () => {
    console.log(
        "Server running at http://localhost:3000"
    );
});